import { createApiClient } from "@ear-dream/core";

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";

export const api = createApiClient(baseUrl);
