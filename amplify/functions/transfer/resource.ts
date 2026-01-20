import { defineFunction } from "@aws-amplify/backend";

export const transfer = defineFunction({
  entry: "./handler.ts",
});
