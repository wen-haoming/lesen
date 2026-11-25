import { isAllowedAnalyticsEndpoint } from "./analytics";

export const ANALYTICS_ENDPOINT = String(import.meta.env.WXT_PUBLIC_ANALYTICS_ENDPOINT || "");
export const ANALYTICS_BUILD_ENABLED = isAllowedAnalyticsEndpoint(ANALYTICS_ENDPOINT);
