import { a, defineData } from "@aws-amplify/backend";
import { transfer } from "../functions/transfer/resource";

const schema = a
  .schema({
  ArtworkPublic: a
    .model({
      artworkId: a.string().required(),
      scenePath: a.string().required(),
      status: a.enum(["UNCLAIMED", "OWNED"]),
    })
    .identifier(["artworkId"])
    .authorization((allow) => [
      allow.publicApiKey().to(["read"]),
    ]),

  Ownership: a
    .model({
      artworkId: a.string().required(),
      ownerSub: a.string(),
      status: a.enum(["UNCLAIMED", "OWNED"]),
    })
    .identifier(["artworkId"])
    .authorization((allow) => [
      allow.ownerDefinedIn("ownerSub").to(["read"]),
    ]),

  TransferCode: a
    .model({
      code: a.string().required(),
      artworkId: a.string().required(),
      createdBySub: a.string().required(),
      expiresAt: a.datetime().required(),
      usedAt: a.datetime(),
    })
    .identifier(["code"])
    .authorization((allow) => [
      allow.ownerDefinedIn("createdBySub").to([
        "create",
        "read",
        "update",
        "delete",
      ]),
    ]),

  TransferCreateResult: a.customType({
    code: a.string().required(),
    artworkId: a.string().required(),
    expiresAt: a.datetime().required(),
  }),

  TransferClaimResult: a.customType({
    artworkId: a.string().required(),
    scenePath: a.string().required(),
    status: a.enum(["UNCLAIMED", "OWNED"]),
  }),

  createTransfer: a
    .mutation()
    .arguments({
      artworkId: a.string().required(),
      ttlMinutes: a.integer(),
    })
    .returns(a.ref("TransferCreateResult"))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(transfer)),

  claimTransfer: a
    .mutation()
    .arguments({
      code: a.string().required(),
    })
    .returns(a.ref("TransferClaimResult"))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(transfer)),

  claimUnclaimed: a
    .mutation()
    .arguments({
      artworkId: a.string().required(),
    })
    .returns(a.ref("TransferClaimResult"))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(transfer)),
  })
  .authorization((allow) => [allow.resource(transfer).to(["query", "mutate"])]);

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
    apiKeyAuthorizationMode: {
      expiresInDays: 365,
    },
  },
});
