import { describe, expect, it } from "vitest";
import { testDeps } from "./deps.js";
import { createApp } from "../src/app.js";
import { generateOpenApiSpec } from "../src/openapi.js";

describe("OpenAPI 3.1 Specification & Endpoint (O-04)", () => {
  it("generates a valid OpenAPI 3.1 specification object", () => {
    const spec = generateOpenApiSpec();
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info).toMatchObject({
      title: "Pariksha API",
      version: "1.0.0",
    });

    const paths = spec.paths as Record<string, unknown>;
    expect(paths["/health"]).toBeDefined();
    expect(paths["/workspaces"]).toBeDefined();
    expect(paths["/run/{workspaceSlug}/{testSlug}"]).toBeDefined();
    expect(paths["/run/attempt/submit"]).toBeDefined();

    const components = spec.components as Record<string, unknown>;
    expect(components.securitySchemes).toMatchObject({
      bearerAuth: { type: "http", scheme: "bearer" },
      cookieAuth: { type: "apiKey", in: "cookie" },
    });
    expect((components.schemas as Record<string, unknown>).ApiError).toBeDefined();
  });

  it("serves GET /api/v1/openapi.json over HTTP", async () => {
    const { deps } = await testDeps();
    const app = createApp(deps);

    const res = await app.request("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = (await res.json()) as { openapi: string; info: { title: string } };
    expect(body.openapi).toBe("3.1.0");
    expect(body.info.title).toBe("Pariksha API");
  });
});
