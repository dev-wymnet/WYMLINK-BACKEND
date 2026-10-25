# WymNet API Endpoints (Postman-style)

Base URL: http://localhost:3000/api/v1
Admin Base URL: http://localhost:3000/api/v1/admin

Auth headers:

- Public endpoints: none
- Customer endpoints: Authorization: Bearer <customer_access_token>
- Admin endpoints: Authorization: Bearer <admin_access_token>

---

## Health

GET /health
No auth.

---

## Readiness

GET /ready
No body / no auth.

---

## Customer Auth (/auth)

POST /auth/signup
Body (json):
{
"firstName": "John",
"lastName": "Doe",
"countryCode": "NG",
"email": "customer@example.com",
"phone": "08012345678",
"password": "Str0ngPassw0rd"
}
Note: email or phone is required, not both.

POST /auth/login
Body (json):
{
"email": "customer@example.com",
"password": "Str0ngPassw0rd"
}
Note: email or phone is required.

POST /auth/refresh
Body (json):
{
"refreshToken": "<sessionId>.<token>"
}

POST /auth/logout
Body (json):
{
"refreshToken": "<sessionId>.<token>"
}

---

## Customer PIN (/auth/pin)

POST /auth/pin/transaction/set
Headers:

- Authorization: Bearer <customer_access_token>
  Body (json):
  {
  "pin": "1234"
  }

POST /auth/pin/transaction/change
Headers:

- Authorization: Bearer <customer_access_token>
  Body (json):
  {
  "currentPin": "1234",
  "newPin": "4321"
  }

POST /auth/pin/passcode/change
Headers:

- Authorization: Bearer <customer_access_token>
  Body (json):
  {
  "currentPasscode": "123456",
  "newPasscode": "654321"
  }

POST /auth/pin/transaction/reset/request
Body (json):
{
"email": "customer@example.com"
}
Note: email or phone is required.

POST /auth/pin/transaction/reset/confirm
Body (json):
{
"otp": "123456",
"newPin": "1234"
}

---

## User (/user)

GET /user/me
Headers:

- Authorization: Bearer <customer_access_token>

PATCH /user/me
Headers:

- Authorization: Bearer <customer_access_token>
  Body (json, any of the below):
  {
  "firstName": "John",
  "lastName": "Doe",
  "email": "customer@example.com",
  "phone": "08012345678",
  "countryCode": "NG",
  "preferredCurrency": "NGN"
  }

POST /user/account-update-requests
Headers:

- Authorization: Bearer <customer_access_token>
  Body (json):
  {
  "requestedFields": {
  "firstName": "John",
  "lastName": "Doe",
  "email": "customer@example.com",
  "phone": "08012345678",
  "countryCode": "NG",
  "preferredCurrency": "NGN"
  }
  }

GET /user/account-update-requests
Headers:

- Authorization: Bearer <customer_access_token>

POST /user/support-tickets
Headers:

- Authorization: Bearer <customer_access_token>
  Body (json):
  {
  "subject": "Issue with airtime purchase",
  "message": "I purchased airtime but it did not arrive."
  }

GET /user/support-tickets
Headers:

- Authorization: Bearer <customer_access_token>

PATCH /user/reloadly/enable
Headers:

- Authorization: Bearer <admin_access_token> (admin only; role check is "admin")
  Body (json):
  {
  "userId": "<uuid>",
  "enabled": true
  }

### Verification (/user/me/verification)

GET /user/me/verification
Headers:

- Authorization: Bearer <customer_access_token>

POST /user/me/verification/bvn
Headers:

- Authorization: Bearer <customer_access_token>
  Body (json):
  {
  "bvn": "12345678901",
  "bankCode": "044",
  "accountNumber": "1234567890",
  "name": "John Doe"
  }
  Rate limit: 5 requests per 5 minutes per user.

POST /user/me/verification/nin
Headers:

- Authorization: Bearer <customer_access_token>
  Body (json):
  {
  "nin": "12345678901"
  }
  Rate limit: 5 requests per 5 minutes per user.

---

## Wallet (/wallets)

POST /wallets
Headers:

- Authorization: Bearer <customer_access_token>
  Body (json):
  {
  "currencyCode": "NGN"
  }
  Default currencyCode is NGN.

GET /wallets/me
Headers:

- Authorization: Bearer <customer_access_token>

GET /wallets/transactions
Headers:

- Authorization: Bearer <customer_access_token>
  Query:
- limit: number (default 50, max 200)

GET /wallets/transactions/:id
Headers:

- Authorization: Bearer <customer_access_token>

GET /wallets/reconciliation
Headers:

- Authorization: Bearer <customer_access_token>

POST /wallets/debit
Headers:

- Authorization: Bearer <customer_access_token>
  Body (json):
  {
  "amount": "1000.00",
  "reference": "UNIQUE-REF-001",
  "description": "Debit for service"
  }

---

## Telecom (/telecom)

GET /telecom/networks
Headers:

- Authorization: Bearer <customer_access_token> (optional; unauth falls back to peyflex defaults)

GET /telecom/data/plans
Headers:

- Authorization: Bearer <customer_access_token> (optional)
  Query:
- provider: peyflex|reloadly (optional)
- network: string (required)

POST /telecom/airtime/purchase
Headers:

- Authorization: Bearer <customer_access_token>
  Body (json):
  {
  "internalReference": "UNIQUE-REF-002",
  "provider": "peyflex",
  "network": "mtn",
  "amount": 1000,
  "mobileNumber": "08012345678"
  }
  provider is optional; defaults to country logic.

POST /telecom/data/purchase
Headers:

- Authorization: Bearer <customer_access_token>
  Body (json):
  {
  "internalReference": "UNIQUE-REF-003",
  "provider": "peyflex",
  "network": "mtn",
  "planCode": "MTN-1GB-30D",
  "mobileNumber": "08012345678"
  }

---

## Bills (/bills)

### Cable TV

GET /bills/cable/providers
No auth required.

GET /bills/cable/plans
No auth required.
Query:

- identifier: string (required)

POST /bills/cable/verify
Headers:

- Authorization: Bearer <customer_access_token>
  Body (json):
  {
  "identifier": "dstv",
  "iuc": "1234567890"
  }

POST /bills/cable/subscribe
Headers:

- Authorization: Bearer <customer_access_token>
  Body (json):
  {
  "internalReference": "UNIQUE-REF-004",
  "identifier": "dstv",
  "plan": "DStv Compact",
  "iuc": "1234567890",
  "phone": "08012345678",
  "amount": 10000
  }
  amount is optional; plan price is used when omitted.

### Electricity

GET /bills/electricity/plans
No auth required.

GET /bills/electricity/verify
No auth required.
Query:

- meter: string (required)
- plan: string (required)
- type: string (required)

POST /bills/electricity/subscribe
Headers:

- Authorization: Bearer <customer_access_token>
  Body (json):
  {
  "internalReference": "UNIQUE-REF-005",
  "meter": "12345678901",
  "plan": "ikeja-prepaid",
  "amount": 5000,
  "type": "prepaid",
  "phone": "08012345678"
  }

---

## Payouts (/payouts)

POST /payouts
Headers:

- Authorization: Bearer <customer_access_token>
  Body (json):
  {
  "amount": "1000.00",
  "bankCode": "044",
  "accountNumber": "1234567890",
  "narration": "Payout to customer"
  }
  Rate limit: 5 requests per 5 minutes per user.

GET /payouts/banks
Headers:

- Authorization: Bearer <customer_access_token>

GET /payouts/validate-account
Headers:

- Authorization: Bearer <customer_access_token>
  Query:
- bankCode: string (required)
- accountNumber: string (required)
  Rate limit: 30 requests per 5 minutes per user.

GET /payouts/status/by-reference
Headers:

- Authorization: Bearer <customer_access_token>
  Query:
- reference: string (required)

GET /payouts/:id
Headers:

- Authorization: Bearer <customer_access_token>

---

## Dashboard (/dashboard)

GET /dashboard/home
Headers:

- Authorization: Bearer <customer_access_token>

---

## Geolocation (/regions)

GET /regions/current
Headers:

- Authorization: Bearer <customer_access_token>

---

## System (/system)

GET /system/architecture
No auth.

GET /system/debug/env
No auth.

GET /system/debug/db
No auth.

GET /system/debug/readiness
No auth.

---

## Training (/training)

POST /training/register
Body (json):
{
"fullName": "John Doe",
"email": "john@example.com",
"phone": "08012345678"
}

GET /training/registrations
Headers:

- Authorization: Bearer <admin_access_token> (admin only; role must be "admin")

---

## Webhooks

POST /webhooks/monnify
External Monnify webhook. No customer auth required.

POST /webhooks/monnify-debug
Temporary diagnostic endpoint. No customer auth required.

---

# Admin Endpoints (Base URL: http://localhost:3000/api/v1/admin)

All admin endpoints require:

- authGuard
- requireAdmin
- requirePermission(...) (unless stated)

Note: Only super_admin and finance_admin can access financial read endpoints. Only super_admin can create/promote super_admin.

---

## Admin Auth

POST /admin/auth/login
Body (json):
{
"email": "admin@example.com",
"password": "Str0ngPassw0rd"
}
Note: email or phone is required.

POST /admin/auth/refresh
Body (json):
{
"refreshToken": "<sessionId>.<token>"
}

POST /admin/auth/logout
Body (json):
{
"refreshToken": "<sessionId>.<token>"
}

POST /admin/auth/signup-temp
Body (json):
{
"email": "admin@example.com",
"password": "Str0ngPassw0rd",
"firstName": "Admin",
"lastName": "Bootstrap",
"role": "super_admin"
}
Note: temporary bootstrap endpoint (requires admin action token).

GET /admin/auth/me
Headers:

- Authorization: Bearer <admin_access_token>

---

## Admin Management (requires ADMIN_MANAGE_ADMINS)

GET /admin/admins
Query:

- page: number (default 1)
- limit: number (default 20)
- search: string (optional)

GET /admin/admins/:id

POST /admin/admins
Body (json):
{
"firstName": "John",
"lastName": "Doe",
"email": "john@example.com",
"phone": "08012345678",
"countryCode": "NG",
"role": "business_admin|finance_admin|super_admin",
"temporaryPassword": "Str0ngPassw0rd"
}

PATCH /admin/admins/:id/status
Body (json):
{
"status": "active|disabled"
}

PATCH /admin/admins/:id/role
Body (json):
{
"role": "business_admin|finance_admin|super_admin"
}

GET /admin/admins/:id/sessions

POST /admin/admins/:id/sessions/revoke

---

## Admin Payouts OTP (requires ADMIN_MANAGE_PAYOUTS)

POST /admin/payouts/otp/validate
Body (json):
{
"reference": "WYMNET-PAYOUT-...",
"otp": "123456"
}

POST /admin/payouts/otp/resend
Body (json):
{
"reference": "WYMNET-PAYOUT-..."
}

---

## Admin Payments (requires ADMIN_VIEW_PAYMENTS)

GET /admin/payments
Query (all optional unless stated):

- from: ISO8601 date
- to: ISO8601 date
- customerId: uuid
- search: string (reference/providerRef/customer name/email/phone)
- country: string(2-3)
- currency: string(3)
- status: string (wallet_ledger.status)
- type: string (wallet_ledger.transaction_type)
- direction: credit|debit
- provider: string
- page: number (default 1)
- limit: number (default 50)
- sort: date|amount (default date)
- order: asc|desc (default desc)

GET /admin/payments/:id

---

## Admin Bills (requires ADMIN_VIEW_BILLS)

GET /admin/bills
Query (all optional unless stated):

- from: ISO8601 date
- to: ISO8601 date
- customerId: uuid
- search: string (reference/providerRef/customer name/email/phone)
- country: string(2-3)
- currency: string(3)
- status: string (telecom_transactions.status)
- type: airtime|data
- provider: string
- page: number (default 1)
- limit: number (default 50)
- sort: date|amount (default date)
- order: asc|desc (default desc)

GET /admin/bills/:id

---

## Admin Dashboard

GET /admin/dashboard/home
Headers:

- Authorization: Bearer <admin_access_token>

---

## Admin Customers

GET /admin/customers
Headers:

- Authorization: Bearer <admin_access_token>
  Query (all optional unless stated):

- page: number (default 1)
- limit: number (default 20)
- search: string (optional)
- status: string (optional)
- country: string (2-3)

GET /admin/customers/:customerId
Headers:

- Authorization: Bearer <admin_access_token>

GET /admin/customers/:customerId/transactions
Headers:

- Authorization: Bearer <admin_access_token>
  Query:

- page: number (default 1)
- limit: number (default 20)

PATCH /admin/customers/:customerId/status
Headers:

- Authorization: Bearer <admin_access_token>
  Body (json):
  {
  "status": "active|suspended|disabled"
  }
