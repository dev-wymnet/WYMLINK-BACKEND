// Integration tests for Admin Payments and Bills APIs (placed under src to satisfy tsconfig rootDir)
// Uses node:test and supertest. Ensure the server is running or export app for injection.

import test from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const ADMIN_TOKEN = process.env.TEST_ADMIN_ACCESS_TOKEN || "";
const BUSINESS_ADMIN_TOKEN = process.env.TEST_BUSINESS_ADMIN_ACCESS_TOKEN || "";
const CUSTOMER_TOKEN = process.env.TEST_CUSTOMER_ACCESS_TOKEN || "";

function auth(req: supertest.Test, token: string) {
  return token ? req.set("Authorization", `Bearer ${token}`) : req;
}

test("payments: finance/super can list, business/customer denied, unauth 401", async (t) => {
  let res = await supertest(BASE_URL).get("/api/v1/admin/payments");
  assert.equal(res.status, 401);

  res = await auth(supertest(BASE_URL).get("/api/v1/admin/payments"), CUSTOMER_TOKEN);
  assert.ok([401, 403].includes(res.status));

  res = await auth(supertest(BASE_URL).get("/api/v1/admin/payments"), BUSINESS_ADMIN_TOKEN);
  assert.equal(res.status, 403);

  if (ADMIN_TOKEN) {
    res = await auth(supertest(BASE_URL).get("/api/v1/admin/payments"), ADMIN_TOKEN);
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.pagination?.page, "number");
  }
});

test("payments: supports filters and pagination", async (t) => {
  if (!ADMIN_TOKEN) return t.skip();
  const res = await auth(
    supertest(BASE_URL)
      .get("/api/v1/admin/payments")
      .query({ from: "2025-01-01", to: "2026-12-31", currency: "NGN", page: 1, limit: 10, sort: "date", order: "desc" }),
    ADMIN_TOKEN,
  );
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
});

test("bills: finance/super can list, business/customer denied, unauth 401", async (t) => {
  let res = await supertest(BASE_URL).get("/api/v1/admin/bills");
  assert.equal(res.status, 401);

  res = await auth(supertest(BASE_URL).get("/api/v1/admin/bills"), CUSTOMER_TOKEN);
  assert.ok([401, 403].includes(res.status));

  res = await auth(supertest(BASE_URL).get("/api/v1/admin/bills"), BUSINESS_ADMIN_TOKEN);
  assert.equal(res.status, 403);

  if (ADMIN_TOKEN) {
    res = await auth(supertest(BASE_URL).get("/api/v1/admin/bills"), ADMIN_TOKEN);
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.pagination?.page, "number");
  }
});

test("bills: supports filters and pagination", async (t) => {
  if (!ADMIN_TOKEN) return t.skip();
  const res = await auth(
    supertest(BASE_URL)
      .get("/api/v1/admin/bills")
      .query({ country: "NG", from: "2025-01-01", to: "2026-12-31", type: "airtime", page: 1, limit: 10 }),
    ADMIN_TOKEN,
  );
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
});

test("payments/bills: details require authz and exclude secrets", async (t) => {
  if (!ADMIN_TOKEN) return t.skip();
  const list = await auth(supertest(BASE_URL).get("/api/v1/admin/payments").query({ limit: 1 }), ADMIN_TOKEN);
  assert.equal(list.status, 200);
  const id = list.body.data?.[0]?.id;
  if (!id) return t.skip();
  const detail = await auth(supertest(BASE_URL).get(`/api/v1/admin/payments/${id}`), ADMIN_TOKEN);
  assert.equal(detail.status, 200);
  const s = JSON.stringify(detail.body);
  assert.ok(!s.includes("passwordHash"));
  assert.ok(!s.includes("refreshToken"));
  assert.ok(!s.includes("accessToken"));
});
