import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

type AppSyncEvent = {
  arguments?: Record<string, unknown>;
  info?: {
    fieldName?: string;
  };
  identity?: {
    sub?: string;
    claims?: {
      sub?: string;
    };
  };
};

let client: any | null = null;

async function getClient(): Promise<any> {
  if (client) {
    return client;
  }

  const env = ((globalThis as { process?: { env?: unknown } }).process
    ?.env ?? {}) as never;
  const { resourceConfig, libraryOptions } =
    await getAmplifyDataClientConfig(env);
  Amplify.configure(resourceConfig, libraryOptions);
  client = generateClient();
  return client;
}

function requireSub(event: AppSyncEvent) {
  const sub = event.identity?.sub ?? event.identity?.claims?.sub;
  if (!sub) {
    throw new Error("Unauthorized");
  }
  return sub;
}

function asString(value: unknown, name: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function asOptionalInt(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }
  return value;
}

export const handler = async (event: AppSyncEvent) => {
  const fieldName = event.info?.fieldName;
  switch (fieldName) {
    case "createTransfer":
      return await handleCreateTransfer(event);
    case "claimTransfer":
      return await handleClaimTransfer(event);
    case "claimUnclaimed":
      return await handleClaimUnclaimed(event);
    default:
      throw new Error("Unsupported operation");
  }
};

async function handleCreateTransfer(event: AppSyncEvent) {
  const client = await getClient();
  const ownerSub = requireSub(event);
  const artworkId = asString(event.arguments?.artworkId, "artworkId");
  const ttlMinutes = asOptionalInt(event.arguments?.ttlMinutes, 10);

  const ownership = await client.models.Ownership.get({ artworkId });
  if (!ownership.data || ownership.data.ownerSub !== ownerSub) {
    throw new Error("Only the current owner can transfer this artwork");
  }

  const expiresAt = new Date(
    Date.now() + ttlMinutes * 60 * 1000,
  ).toISOString();
  const code = generateCode();

  await client.models.TransferCode.create({
    code,
    artworkId,
    createdBySub: ownerSub,
    expiresAt,
  });

  return {
    code,
    artworkId,
    expiresAt,
  };
}

async function handleClaimTransfer(event: AppSyncEvent) {
  const client = await getClient();
  const claimantSub = requireSub(event);
  const code = asString(event.arguments?.code, "code");

  const transfer = await client.models.TransferCode.get({ code });
  if (!transfer.data) {
    throw new Error("Invalid transfer code");
  }

  if (transfer.data.usedAt) {
    throw new Error("Transfer code already used");
  }

  const now = new Date();
  if (new Date(transfer.data.expiresAt) <= now) {
    throw new Error("Transfer code expired");
  }

  const artworkId = transfer.data.artworkId;
  const ownership = await client.models.Ownership.get({ artworkId });
  if (
    ownership.data?.ownerSub &&
    ownership.data.ownerSub !== transfer.data.createdBySub
  ) {
    throw new Error("Transfer code no longer valid");
  }

  const artwork = await client.models.ArtworkPublic.get({ artworkId });
  if (!artwork.data) {
    throw new Error("Artwork not found");
  }

  if (ownership.data) {
    await client.models.Ownership.update({
      artworkId,
      ownerSub: claimantSub,
      status: "OWNED",
    });
  } else {
    await client.models.Ownership.create({
      artworkId,
      ownerSub: claimantSub,
      status: "OWNED",
    });
  }

  await client.models.ArtworkPublic.update({
    artworkId,
    scenePath: artwork.data.scenePath,
    status: "OWNED",
  });

  await client.models.TransferCode.update({
    code,
    usedAt: now.toISOString(),
  });

  return {
    artworkId,
    scenePath: artwork.data.scenePath,
    status: "OWNED",
  };
}

async function handleClaimUnclaimed(event: AppSyncEvent) {
  const client = await getClient();
  const claimantSub = requireSub(event);
  const artworkId = asString(event.arguments?.artworkId, "artworkId");

  const artwork = await client.models.ArtworkPublic.get({ artworkId });
  if (!artwork.data) {
    throw new Error("Artwork not found");
  }

  const ownership = await client.models.Ownership.get({ artworkId });
  if (ownership.data?.status === "OWNED") {
    throw new Error("Artwork already claimed");
  }

  if (ownership.data) {
    await client.models.Ownership.update({
      artworkId,
      ownerSub: claimantSub,
      status: "OWNED",
    });
  } else {
    await client.models.Ownership.create({
      artworkId,
      ownerSub: claimantSub,
      status: "OWNED",
    });
  }

  await client.models.ArtworkPublic.update({
    artworkId,
    scenePath: artwork.data.scenePath,
    status: "OWNED",
  });

  return {
    artworkId,
    scenePath: artwork.data.scenePath,
    status: "OWNED",
  };
}

function generateCode() {
  const bytes = new Uint8Array(12);
  const cryptoObj = (globalThis as { crypto?: { getRandomValues?: Function } })
    .crypto;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}
