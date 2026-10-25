/**
 * Hand-maintained OpenAPI 3.0 document for the Wymlink API.
 * Covers every route mounted under /api/v1 in src/server.ts.
 */

const bearer = [{ bearerAuth: [] }];

const jsonBody = (schema: object, required = true) => ({
  required,
  content: { "application/json": { schema } },
});

const ok = (description: string, schema?: object) => ({
  description,
  ...(schema
    ? { content: { "application/json": { schema } } }
    : {}),
});

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const resRef = (name: string) => ({ $ref: `#/components/responses/${name}` });

const okResponse = {
  type: "object",
  properties: { ok: { type: "boolean", example: true } },
};

const paginatedQuery = (extra: Record<string, object> = {}) => [
  { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
  {
    name: "limit",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
  },
  { name: "sort", in: "query", schema: { type: "string", enum: ["date", "amount"], default: "date" } },
  { name: "order", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "desc" } },
  { name: "from", in: "query", schema: { type: "string", format: "date-time", description: "ISO 8601 date or date-time" } },
  { name: "to", in: "query", schema: { type: "string", format: "date-time", description: "ISO 8601 date or date-time" } },
  ...Object.entries(extra).map(([name, schema]) => ({ name, in: "query", schema })),
];

export function getOpenAPIDocument() {
  return {
    openapi: "3.0.3",
    info: {
      title: "Wymlink API",
      version: "1.0.0",
      description:
        "REST API for the Wymlink platform: customer auth, wallets, airtime/data, bill payments, payouts, KYC verification and the admin back-office API.",
    },
    servers: [{ url: "/api/v1" }],
    tags: [
      { name: "Health" },
      { name: "Auth" },
      { name: "PIN" },
      { name: "User" },
      { name: "Verification" },
      { name: "Wallet" },
      { name: "Telecom" },
      { name: "Bills" },
      { name: "Dashboard" },
      { name: "Geolocation" },
      { name: "System" },
      { name: "Training" },
      { name: "Payouts" },
      { name: "Webhooks" },
      { name: "Admin Auth" },
      { name: "Admin Management" },
      { name: "Admin Payouts" },
      { name: "Admin Payments" },
      { name: "Admin Bills" },
      { name: "Admin Dashboard" },
      { name: "Admin Customers" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "JWT access token returned by /auth/login or /admin/auth/login.",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error: {
              type: "object",
              properties: {
                code: { type: "string", example: "VALIDATION_ERROR" },
                message: { type: "string", example: "Validation failed" },
                details: {},
              },
              required: ["code", "message"],
            },
          },
          required: ["success", "error"],
        },
        AuthTokens: {
          type: "object",
          properties: {
            user: {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
                role: { type: "string", example: "customer" },
              },
            },
            accessToken: { type: "string" },
            refreshToken: {
              type: "string",
              description: "Opaque token in the form <sessionId>.<token>",
            },
            accessTokenExpiresInSeconds: { type: "integer" },
            refreshTokenExpiresInSeconds: { type: "integer" },
          },
        },
        User: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            firstName: { type: "string" },
            lastName: { type: "string" },
            email: { type: "string", format: "email", nullable: true },
            phone: { type: "string", nullable: true },
            countryCode: { type: "string", example: "NG" },
            currencyCode: { type: "string", example: "NGN" },
            preferredCurrency: { type: "string", nullable: true },
            complianceRegion: { type: "string", nullable: true },
            complianceTier: { type: "string", nullable: true },
            kycStatus: { type: "string", nullable: true },
            status: { type: "string", enum: ["active", "disabled"] },
            role: { type: "string", example: "customer" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        Wallet: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            userId: { type: "string", format: "uuid" },
            currencyCode: { type: "string", example: "NGN" },
            availableBalance: { type: "string", example: "0.00" },
            ledgerBalance: { type: "string", example: "0.00" },
            status: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        ReservedAccount: {
          type: "object",
          properties: {
            accountNumber: { type: "string", example: "1234567890" },
            bankName: { type: "string", example: "Moniepoint MFB" },
            accountName: { type: "string" },
          },
        },
        Transaction: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            walletId: { type: "string", format: "uuid" },
            transactionType: { type: "string" },
            direction: { type: "string", enum: ["credit", "debit"] },
            amount: { type: "string" },
            currency: { type: "string" },
            status: { type: "string" },
            reference: { type: "string" },
            provider: { type: "string", nullable: true },
            description: { type: "string", nullable: true },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        Payout: {
          type: "object",
          properties: {
            id: { type: "string" },
            userId: { type: "string", format: "uuid" },
            reference: { type: "string" },
            amount: { type: "string" },
            currency: { type: "string" },
            bankCode: { type: "string" },
            accountNumber: { type: "string" },
            narration: { type: "string" },
            status: {
              type: "string",
              enum: ["PENDING", "SUCCESS", "FAILED"],
            },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        Bank: {
          type: "object",
          properties: {
            name: { type: "string" },
            code: { type: "string" },
          },
        },
        Admin: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            firstName: { type: "string" },
            lastName: { type: "string" },
            email: { type: "string", format: "email", nullable: true },
            phone: { type: "string", nullable: true },
            countryCode: { type: "string" },
            role: {
              type: "string",
              enum: ["super_admin", "business_admin", "finance_admin"],
            },
            status: { type: "string", enum: ["active", "disabled"] },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        TrainingRegistration: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            fullName: { type: "string" },
            email: { type: "string", format: "email" },
            phone: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
      },
      responses: {
        BadRequest: {
          description: "Validation failed",
          content: { "application/json": { schema: ref("Error") } },
        },
        Unauthorized: {
          description: "Missing, invalid or expired access token",
          content: { "application/json": { schema: ref("Error") } },
        },
        Forbidden: {
          description: "Authenticated but lacks the required role/permission",
          content: { "application/json": { schema: ref("Error") } },
        },
        NotFound: {
          description: "Resource not found",
          content: { "application/json": { schema: ref("Error") } },
        },
        TooManyRequests: {
          description: "Rate limit exceeded",
          content: { "application/json": { schema: ref("Error") } },
        },
        InternalError: {
          description: "Internal server error",
          content: { "application/json": { schema: ref("Error") } },
        },
      },
    },
    paths: {
      // ------------------------------------------------------------------
      // Health
      // ------------------------------------------------------------------
      "/health": {
        get: {
          tags: ["Health"],
          summary: "Liveness probe",
          operationId: "getHealth",
          responses: {
            "200": ok("Service is alive", {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                uptimeSeconds: { type: "integer" },
              },
            }),
          },
        },
      },
      "/ready": {
        get: {
          tags: ["Health"],
          summary: "Readiness probe",
          operationId: "getReady",
          responses: {
            "200": ok("Service is ready or degraded", {
              type: "object",
              properties: {
                status: { type: "string", enum: ["ok", "degraded"] },
              },
            }),
            "503": ok("Service is not ready", {
              type: "object",
              properties: { status: { type: "string", example: "error" } },
            }),
          },
        },
      },

      // ------------------------------------------------------------------
      // Auth
      // ------------------------------------------------------------------
      "/auth/signup": {
        post: {
          tags: ["Auth"],
          summary: "Register a new customer account",
          description:
            "Either `email` or `phone` must be provided. Creates the user, wallet and reserved account, then returns tokens.",
          operationId: "signup",
          requestBody: jsonBody({
            type: "object",
            properties: {
              firstName: { type: "string", minLength: 1, maxLength: 100 },
              lastName: { type: "string", minLength: 1, maxLength: 100 },
              countryCode: { type: "string", minLength: 2, maxLength: 3, example: "NG" },
              email: { type: "string", format: "email" },
              phone: { type: "string", minLength: 7, maxLength: 20, example: "08012345678" },
              password: { type: "string", minLength: 8, maxLength: 72 },
            },
            required: ["firstName", "lastName", "countryCode", "password"],
          }),
          responses: {
            "201": ok("Account created", ref("AuthTokens")),
            "400": resRef("BadRequest"),
            "500": resRef("InternalError"),
          },
        },
      },
      "/auth/login": {
        post: {
          tags: ["Auth"],
          summary: "Customer login",
          description: "Either `email` or `phone` must be provided.",
          operationId: "login",
          requestBody: jsonBody({
            type: "object",
            properties: {
              email: { type: "string", format: "email" },
              phone: { type: "string", minLength: 7, maxLength: 20 },
              password: { type: "string", minLength: 1, maxLength: 72 },
            },
            required: ["password"],
          }),
          responses: {
            "200": ok("Login successful", ref("AuthTokens")),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
          },
        },
      },
      "/auth/refresh": {
        post: {
          tags: ["Auth"],
          summary: "Exchange a refresh token for a new access token",
          operationId: "refreshToken",
          requestBody: jsonBody({
            type: "object",
            properties: { refreshToken: { type: "string", minLength: 1 } },
            required: ["refreshToken"],
          }),
          responses: {
            "200": ok("New access token", {
              type: "object",
              properties: {
                accessToken: { type: "string" },
                accessTokenExpiresInSeconds: { type: "integer" },
              },
            }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
          },
        },
      },
      "/auth/logout": {
        post: {
          tags: ["Auth"],
          summary: "Invalidate a refresh token (log out)",
          operationId: "logout",
          requestBody: jsonBody({
            type: "object",
            properties: { refreshToken: { type: "string", minLength: 1 } },
            required: ["refreshToken"],
          }),
          responses: {
            "204": { description: "Session revoked" },
            "400": resRef("BadRequest"),
          },
        },
      },
      "/auth/password/forgot": {
        post: {
          tags: ["Auth"],
          summary: "Request a password reset code via email",
          operationId: "forgotPassword",
          requestBody: jsonBody({
            type: "object",
            properties: { email: { type: "string", format: "email" } },
            required: ["email"],
          }),
          responses: {
            "200": ok("Reset code sent if the account exists", okResponse),
            "400": resRef("BadRequest"),
          },
        },
      },
      "/auth/password/reset": {
        post: {
          tags: ["Auth"],
          summary: "Reset password with the emailed code",
          operationId: "resetPassword",
          requestBody: jsonBody({
            type: "object",
            properties: {
              email: { type: "string", format: "email" },
              code: { type: "string", minLength: 4, maxLength: 10 },
              newPassword: { type: "string", minLength: 8, maxLength: 72 },
            },
            required: ["email", "code", "newPassword"],
          }),
          responses: {
            "200": ok("Password reset", okResponse),
            "400": resRef("BadRequest"),
          },
        },
      },

      // ------------------------------------------------------------------
      // PIN
      // ------------------------------------------------------------------
      "/auth/pin/transaction/set": {
        post: {
          tags: ["PIN"],
          summary: "Set the 4-digit transaction PIN",
          operationId: "setTransactionPin",
          security: bearer,
          requestBody: jsonBody({
            type: "object",
            properties: { pin: { type: "string", pattern: "^\\d{4}$", example: "1234" } },
            required: ["pin"],
          }),
          responses: {
            "200": ok("PIN set", okResponse),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
          },
        },
      },
      "/auth/pin/transaction/change": {
        post: {
          tags: ["PIN"],
          summary: "Change the transaction PIN",
          operationId: "changeTransactionPin",
          security: bearer,
          requestBody: jsonBody({
            type: "object",
            properties: {
              currentPin: { type: "string", pattern: "^\\d{4}$" },
              newPin: { type: "string", pattern: "^\\d{4}$" },
            },
            required: ["currentPin", "newPin"],
          }),
          responses: {
            "200": ok("PIN changed", okResponse),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
          },
        },
      },
      "/auth/pin/passcode/change": {
        post: {
          tags: ["PIN"],
          summary: "Change the 6-digit app passcode",
          operationId: "changePasscode",
          security: bearer,
          requestBody: jsonBody({
            type: "object",
            properties: {
              currentPasscode: { type: "string", pattern: "^\\d{6}$" },
              newPasscode: { type: "string", pattern: "^\\d{6}$" },
            },
            required: ["currentPasscode", "newPasscode"],
          }),
          responses: {
            "200": ok("Passcode changed", okResponse),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
          },
        },
      },
      "/auth/pin/transaction/reset/request": {
        post: {
          tags: ["PIN"],
          summary: "Request a transaction-PIN reset OTP via email",
          operationId: "requestTransactionPinReset",
          requestBody: jsonBody({
            type: "object",
            properties: { email: { type: "string", format: "email" } },
            required: ["email"],
          }),
          responses: {
            "200": ok("OTP sent if the account exists", okResponse),
            "400": resRef("BadRequest"),
          },
        },
      },
      "/auth/pin/transaction/reset/confirm": {
        post: {
          tags: ["PIN"],
          summary: "Reset the transaction PIN using the emailed OTP",
          operationId: "resetTransactionPin",
          requestBody: jsonBody({
            type: "object",
            properties: {
              email: { type: "string", format: "email" },
              code: { type: "string", minLength: 4 },
              newPin: { type: "string", pattern: "^\\d{4}$" },
            },
            required: ["email", "code", "newPin"],
          }),
          responses: {
            "200": ok("PIN reset", okResponse),
            "400": resRef("BadRequest"),
          },
        },
      },

      // ------------------------------------------------------------------
      // User
      // ------------------------------------------------------------------
      "/user/me": {
        get: {
          tags: ["User"],
          summary: "Get the authenticated user's profile",
          operationId: "getMe",
          security: bearer,
          responses: {
            "200": ok("Current user", {
              type: "object",
              properties: { user: ref("User") },
            }),
            "401": resRef("Unauthorized"),
          },
        },
        patch: {
          tags: ["User"],
          summary: "Update the authenticated user's profile",
          operationId: "updateProfile",
          security: bearer,
          requestBody: jsonBody(
            {
              type: "object",
              properties: {
                firstName: { type: "string" },
                lastName: { type: "string" },
                email: { type: "string", format: "email" },
                phone: { type: "string" },
                countryCode: { type: "string" },
                preferredCurrency: { type: "string" },
              },
            },
            false,
          ),
          responses: {
            "200": ok("Updated user", {
              type: "object",
              properties: { user: ref("User") },
            }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
          },
        },
      },
      "/user/account-update-requests": {
        post: {
          tags: ["User"],
          summary: "Request a profile field change (e.g. name correction)",
          operationId: "createAccountUpdateRequest",
          security: bearer,
          requestBody: jsonBody({
            type: "object",
            properties: {
              requestedFields: {
                type: "object",
                description:
                  "Subset of: firstName, lastName, email, phone, countryCode, preferredCurrency. Must contain at least one valid field.",
                properties: {
                  firstName: { type: "string" },
                  lastName: { type: "string" },
                  email: { type: "string", format: "email" },
                  phone: { type: "string" },
                  countryCode: { type: "string" },
                  preferredCurrency: { type: "string" },
                },
              },
            },
            required: ["requestedFields"],
          }),
          responses: {
            "201": ok("Request created", {
              type: "object",
              properties: { request: { type: "object" } },
            }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
          },
        },
        get: {
          tags: ["User"],
          summary: "List my account update requests",
          operationId: "listAccountUpdateRequests",
          security: bearer,
          responses: {
            "200": ok("My requests", {
              type: "object",
              properties: {
                requests: { type: "array", items: { type: "object" } },
              },
            }),
            "401": resRef("Unauthorized"),
          },
        },
      },
      "/user/support-tickets": {
        post: {
          tags: ["User"],
          summary: "Open a support ticket",
          operationId: "createSupportTicket",
          security: bearer,
          requestBody: jsonBody({
            type: "object",
            properties: {
              subject: { type: "string" },
              message: { type: "string" },
            },
            required: ["subject", "message"],
          }),
          responses: {
            "201": ok("Ticket created", {
              type: "object",
              properties: { ticket: { type: "object" } },
            }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
          },
        },
        get: {
          tags: ["User"],
          summary: "List my support tickets",
          operationId: "listSupportTickets",
          security: bearer,
          responses: {
            "200": ok("My tickets", {
              type: "object",
              properties: {
                tickets: { type: "array", items: { type: "object" } },
              },
            }),
            "401": resRef("Unauthorized"),
          },
        },
      },
      "/user/reloadly/enable": {
        patch: {
          tags: ["User"],
          summary: "Enable/disable Reloadly as the telecom provider for a user (admin only)",
          operationId: "setReloadlyEnabled",
          security: bearer,
          requestBody: jsonBody({
            type: "object",
            properties: {
              userId: { type: "string", format: "uuid" },
              enabled: { type: "boolean" },
            },
            required: ["userId", "enabled"],
          }),
          responses: {
            "200": ok("Flag updated", okResponse),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
          },
        },
      },

      // ------------------------------------------------------------------
      // Verification
      // ------------------------------------------------------------------
      "/user/me/verification": {
        get: {
          tags: ["Verification"],
          summary: "Get my KYC verification status",
          operationId: "getMyVerification",
          security: bearer,
          responses: {
            "200": ok("Verification status", { type: "object" }),
            "401": resRef("Unauthorized"),
          },
        },
      },
      "/user/me/verification/bvn": {
        post: {
          tags: ["Verification"],
          summary: "Submit BVN verification",
          description: "Rate limited to 5 requests per 5 minutes per user.",
          operationId: "submitBvnVerification",
          security: bearer,
          requestBody: jsonBody({
            type: "object",
            properties: {
              bvn: { type: "string", pattern: "^\\d{11}$" },
              bankCode: { type: "string", minLength: 1 },
              accountNumber: { type: "string", pattern: "^\\d{10}$" },
              name: { type: "string", minLength: 1 },
            },
            required: ["bvn", "bankCode", "accountNumber", "name"],
          }),
          responses: {
            "200": ok("Verification result", { type: "object" }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
            "429": resRef("TooManyRequests"),
          },
        },
      },
      "/user/me/verification/nin": {
        post: {
          tags: ["Verification"],
          summary: "Submit NIN verification",
          description: "Rate limited to 5 requests per 5 minutes per user.",
          operationId: "submitNinVerification",
          security: bearer,
          requestBody: jsonBody({
            type: "object",
            properties: { nin: { type: "string", pattern: "^\\d{11}$" } },
            required: ["nin"],
          }),
          responses: {
            "200": ok("Verification result", { type: "object" }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
            "429": resRef("TooManyRequests"),
          },
        },
      },

      // ------------------------------------------------------------------
      // Wallet
      // ------------------------------------------------------------------
      "/wallets": {
        post: {
          tags: ["Wallet"],
          summary: "Create a wallet and reserved funding account",
          operationId: "createWallet",
          security: bearer,
          requestBody: jsonBody(
            {
              type: "object",
              properties: {
                currencyCode: {
                  type: "string",
                  minLength: 3,
                  maxLength: 3,
                  default: "NGN",
                },
              },
            },
            false,
          ),
          responses: {
            "201": ok("Wallet created", {
              type: "object",
              properties: {
                wallet: ref("Wallet"),
                reservedAccount: ref("ReservedAccount"),
              },
            }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
          },
        },
      },
      "/wallets/me": {
        get: {
          tags: ["Wallet"],
          summary: "Get my wallet balance and reserved account",
          operationId: "getMyWallet",
          security: bearer,
          responses: {
            "200": ok("Wallet details", {
              type: "object",
              properties: {
                balance: { type: "string" },
                accountNumber: { type: "string", nullable: true },
                bankName: { type: "string", nullable: true },
                wallet: ref("Wallet"),
                reservedAccount: { ...ref("ReservedAccount"), nullable: true },
              },
            }),
            "401": resRef("Unauthorized"),
          },
        },
      },
      "/wallets/transactions": {
        get: {
          tags: ["Wallet"],
          summary: "List my wallet transactions",
          operationId: "listMyTransactions",
          security: bearer,
          parameters: [
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
            },
          ],
          responses: {
            "200": ok("Transactions", {
              type: "object",
              properties: {
                transactions: { type: "array", items: ref("Transaction") },
              },
            }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
          },
        },
      },
      "/wallets/transactions/{id}": {
        get: {
          tags: ["Wallet"],
          summary: "Get one of my transactions by ID",
          operationId: "getMyTransaction",
          security: bearer,
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": ok("Transaction", {
              type: "object",
              properties: { transaction: ref("Transaction") },
            }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
            "404": resRef("NotFound"),
          },
        },
      },
      "/wallets/reconciliation": {
        get: {
          tags: ["Wallet"],
          summary: "Reconcile pending Monnify wallet-funding transactions",
          operationId: "reconcileWallet",
          security: bearer,
          responses: {
            "200": ok("Reconciliation result", {
              type: "object",
              properties: { reconciliation: { type: "object" } },
            }),
            "401": resRef("Unauthorized"),
          },
        },
      },
      "/wallets/debit": {
        post: {
          tags: ["Wallet"],
          summary: "Debit my wallet (requires transaction PIN)",
          operationId: "debitWallet",
          security: bearer,
          requestBody: jsonBody({
            type: "object",
            properties: {
              amount: { type: "string", example: "1000.00" },
              reference: { type: "string", minLength: 8, maxLength: 128 },
              description: { type: "string", minLength: 1, maxLength: 300 },
              transactionPin: { type: "string", pattern: "^\\d{4}$" },
            },
            required: ["amount", "reference", "description", "transactionPin"],
          }),
          responses: {
            "200": ok("Debit result", {
              type: "object",
              properties: { result: { type: "object" } },
            }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
          },
        },
      },

      // ------------------------------------------------------------------
      // Webhooks
      // ------------------------------------------------------------------
      "/webhooks/monnify": {
        post: {
          tags: ["Webhooks"],
          summary: "Monnify payment webhook",
          description:
            "Called by Monnify. The `monnify-signature` header is verified against MONNIFY_SECRET_KEY (unsigned requests are only accepted in non-production sandbox mode when MONNIFY_WEBHOOK_ALLOW_UNSIGNED=true).",
          operationId: "monnifyWebhook",
          parameters: [
            {
              name: "monnify-signature",
              in: "header",
              required: true,
              schema: { type: "string" },
              description: "HMAC-SHA512 signature of the raw request body",
            },
          ],
          requestBody: jsonBody({ type: "object" }),
          responses: {
            "200": ok("Event ingested", {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                result: {
                  type: "object",
                  properties: {
                    eventId: { type: "string" },
                    idempotent: { type: "boolean" },
                  },
                },
              },
            }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
          },
        },
      },

      // ------------------------------------------------------------------
      // Telecom
      // ------------------------------------------------------------------
      "/telecom/networks": {
        get: {
          tags: ["Telecom"],
          summary: "List airtime and data networks",
          description:
            "Provider is resolved from the user's country/settings (peyflex or reloadly) unless overridden.",
          operationId: "listTelecomNetworks",
          security: bearer,
          responses: {
            "200": ok("Networks", {
              type: "object",
              properties: {
                airtimeNetworks: { type: "array", items: { type: "object" } },
                dataNetworks: { type: "array", items: { type: "object" } },
              },
            }),
            "401": resRef("Unauthorized"),
          },
        },
      },
      "/telecom/data/plans": {
        get: {
          tags: ["Telecom"],
          summary: "List data plans for a network",
          operationId: "listDataPlans",
          security: bearer,
          parameters: [
            {
              name: "network",
              in: "query",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "provider",
              in: "query",
              schema: { type: "string", enum: ["peyflex", "reloadly"] },
            },
          ],
          responses: {
            "200": ok("Data plans", { type: "object" }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
          },
        },
      },
      "/telecom/airtime/purchase": {
        post: {
          tags: ["Telecom"],
          summary: "Purchase airtime (requires transaction PIN)",
          operationId: "purchaseAirtime",
          security: bearer,
          requestBody: jsonBody({
            type: "object",
            properties: {
              internalReference: { type: "string", minLength: 8, maxLength: 128 },
              provider: { type: "string", enum: ["peyflex", "reloadly"] },
              network: { type: "string", minLength: 1 },
              amount: { type: "number", exclusiveMinimum: 0 },
              mobileNumber: { type: "string", minLength: 6 },
              transactionPin: { type: "string", pattern: "^\\d{4}$" },
            },
            required: ["internalReference", "network", "amount", "mobileNumber", "transactionPin"],
          }),
          responses: {
            "200": ok("Purchase result", {
              type: "object",
              properties: { transaction: { type: "object" } },
            }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
          },
        },
      },
      "/telecom/data/purchase": {
        post: {
          tags: ["Telecom"],
          summary: "Purchase a data plan (requires transaction PIN)",
          operationId: "purchaseData",
          security: bearer,
          requestBody: jsonBody({
            type: "object",
            properties: {
              internalReference: { type: "string", minLength: 8, maxLength: 128 },
              provider: { type: "string", enum: ["peyflex", "reloadly"] },
              network: { type: "string", minLength: 1 },
              planCode: { type: "string", minLength: 1 },
              mobileNumber: { type: "string", minLength: 6 },
              transactionPin: { type: "string", pattern: "^\\d{4}$" },
            },
            required: ["internalReference", "network", "planCode", "mobileNumber", "transactionPin"],
          }),
          responses: {
            "200": ok("Purchase result", {
              type: "object",
              properties: { transaction: { type: "object" } },
            }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
          },
        },
      },

      // ------------------------------------------------------------------
      // Bills
      // ------------------------------------------------------------------
      "/bills/cable/providers": {
        get: {
          tags: ["Bills"],
          summary: "List cable TV providers",
          operationId: "listCableProviders",
          responses: { "200": ok("Providers", { type: "object" }) },
        },
      },
      "/bills/cable/plans": {
        get: {
          tags: ["Bills"],
          summary: "List plans for a cable provider",
          operationId: "listCablePlans",
          parameters: [
            {
              name: "identifier",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "Provider identifier, e.g. dstv",
            },
          ],
          responses: {
            "200": ok("Plans", { type: "object" }),
            "400": resRef("BadRequest"),
          },
        },
      },
      "/bills/cable/verify": {
        post: {
          tags: ["Bills"],
          summary: "Verify a smartcard/IUC number",
          operationId: "verifyCableIuc",
          security: bearer,
          requestBody: jsonBody({
            type: "object",
            properties: {
              identifier: { type: "string", minLength: 1 },
              iuc: { type: "string", minLength: 4 },
            },
            required: ["identifier", "iuc"],
          }),
          responses: {
            "200": ok("Verification result", { type: "object" }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
          },
        },
      },
      "/bills/cable/subscribe": {
        post: {
          tags: ["Bills"],
          summary: "Subscribe a cable plan (requires transaction PIN)",
          operationId: "subscribeCable",
          security: bearer,
          requestBody: jsonBody({
            type: "object",
            properties: {
              internalReference: { type: "string", minLength: 8, maxLength: 128 },
              identifier: { type: "string", minLength: 1 },
              plan: { type: "string", minLength: 1 },
              iuc: { type: "string", minLength: 4 },
              phone: { type: "string", minLength: 6 },
              amount: { type: "number", exclusiveMinimum: 0 },
              transactionPin: { type: "string", pattern: "^\\d{4}$" },
            },
            required: ["internalReference", "identifier", "plan", "iuc", "phone", "transactionPin"],
          }),
          responses: {
            "200": ok("Subscription result", {
              type: "object",
              properties: { transaction: { type: "object" } },
            }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
          },
        },
      },
      "/bills/electricity/plans": {
        get: {
          tags: ["Bills"],
          summary: "List electricity disco plans",
          operationId: "listElectricityPlans",
          responses: { "200": ok("Plans", { type: "object" }) },
        },
      },
      "/bills/electricity/verify": {
        get: {
          tags: ["Bills"],
          summary: "Verify an electricity meter",
          operationId: "verifyElectricityMeter",
          parameters: [
            { name: "meter", in: "query", required: true, schema: { type: "string", minLength: 6 } },
            { name: "plan", in: "query", required: true, schema: { type: "string" } },
            { name: "type", in: "query", required: true, schema: { type: "string", minLength: 4 }, description: "e.g. prepaid or postpaid" },
          ],
          responses: {
            "200": ok("Verification result", { type: "object" }),
            "400": resRef("BadRequest"),
          },
        },
      },
      "/bills/electricity/subscribe": {
        post: {
          tags: ["Bills"],
          summary: "Pay an electricity bill (requires transaction PIN)",
          operationId: "subscribeElectricity",
          security: bearer,
          requestBody: jsonBody({
            type: "object",
            properties: {
              internalReference: { type: "string", minLength: 8, maxLength: 128 },
              meter: { type: "string", minLength: 6 },
              plan: { type: "string", minLength: 1 },
              amount: { type: "number", exclusiveMinimum: 0 },
              type: { type: "string", minLength: 4 },
              phone: { type: "string", minLength: 6 },
              providerName: { type: "string", maxLength: 120 },
              transactionPin: { type: "string", pattern: "^\\d{4}$" },
            },
            required: ["internalReference", "meter", "plan", "amount", "type", "phone", "transactionPin"],
          }),
          responses: {
            "200": ok("Payment result", {
              type: "object",
              properties: { transaction: { type: "object" } },
            }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
          },
        },
      },

      // ------------------------------------------------------------------
      // Dashboard / Geolocation / System / Training
      // ------------------------------------------------------------------
      "/dashboard/home": {
        get: {
          tags: ["Dashboard"],
          summary: "Customer dashboard home summary",
          operationId: "dashboardHome",
          security: bearer,
          responses: {
            "200": ok("Dashboard summary", { type: "object" }),
            "401": resRef("Unauthorized"),
          },
        },
      },
      "/regions/current": {
        get: {
          tags: ["Geolocation"],
          summary: "Resolve the current region/currency for the request",
          operationId: "currentRegion",
          security: bearer,
          responses: {
            "200": ok("Resolved region", {
              type: "object",
              properties: {
                countryCode: { type: "string" },
                currency: { type: "string" },
                complianceRegion: { type: "string" },
              },
            }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
          },
        },
      },
      "/system/architecture": {
        get: {
          tags: ["System"],
          summary: "Service architecture summary",
          operationId: "architectureSummary",
          responses: { "200": ok("Architecture summary", { type: "object" }) },
        },
      },
      "/training/register": {
        post: {
          tags: ["Training"],
          summary: "Register for the training programme",
          operationId: "registerTraining",
          requestBody: jsonBody({
            type: "object",
            properties: {
              fullName: { type: "string", minLength: 3 },
              email: { type: "string", format: "email" },
              phone: {
                type: "string",
                pattern: "^(?:\\+234|0)\\d{10}$",
                description: "Nigerian phone number: +234XXXXXXXXXX or 0XXXXXXXXXX",
              },
            },
            required: ["fullName", "email", "phone"],
          }),
          responses: {
            "201": ok("Registration created", {
              type: "object",
              properties: { registration: ref("TrainingRegistration") },
            }),
            "400": resRef("BadRequest"),
          },
        },
      },
      "/training/registrations": {
        get: {
          tags: ["Training"],
          summary: "List training registrations (admin only)",
          operationId: "listTrainingRegistrations",
          security: bearer,
          responses: {
            "200": ok("Registrations", {
              type: "object",
              properties: {
                registrations: {
                  type: "array",
                  items: ref("TrainingRegistration"),
                },
              },
            }),
            "401": resRef("Unauthorized"),
            "403": resRef("Forbidden"),
          },
        },
      },

      // ------------------------------------------------------------------
      // Payouts
      // ------------------------------------------------------------------
      "/payouts": {
        post: {
          tags: ["Payouts"],
          summary: "Create a bank payout (requires transaction PIN)",
          description: "Rate limited to 5 requests per 5 minutes per user.",
          operationId: "createPayout",
          security: bearer,
          requestBody: jsonBody({
            type: "object",
            properties: {
              amount: {
                type: "string",
                pattern: "^\\d+(?:\\.\\d{1,8})?$",
                example: "1000.00",
              },
              bankCode: { type: "string", minLength: 2 },
              accountNumber: { type: "string", pattern: "^\\d{10}$" },
              narration: { type: "string", minLength: 1, maxLength: 120 },
              transactionPin: { type: "string", pattern: "^\\d{4}$" },
            },
            required: ["amount", "bankCode", "accountNumber", "narration", "transactionPin"],
          }),
          responses: {
            "202": ok("Payout accepted for processing", {
              type: "object",
              properties: {
                reference: { type: "string" },
                status: { type: "string", example: "PENDING" },
              },
            }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
            "429": resRef("TooManyRequests"),
          },
        },
      },
      "/payouts/banks": {
        get: {
          tags: ["Payouts"],
          summary: "List supported payout banks",
          operationId: "listPayoutBanks",
          security: bearer,
          responses: {
            "200": ok("Banks", {
              type: "object",
              properties: { banks: { type: "array", items: ref("Bank") } },
            }),
            "401": resRef("Unauthorized"),
          },
        },
      },
      "/payouts/validate-account": {
        get: {
          tags: ["Payouts"],
          summary: "Validate a destination bank account",
          description: "Rate limited to 30 requests per 5 minutes per user.",
          operationId: "validatePayoutAccount",
          security: bearer,
          parameters: [
            { name: "bankCode", in: "query", required: true, schema: { type: "string", minLength: 2 } },
            { name: "accountNumber", in: "query", required: true, schema: { type: "string", pattern: "^\\d{10}$" } },
          ],
          responses: {
            "200": ok("Account details", { type: "object" }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
            "429": resRef("TooManyRequests"),
          },
        },
      },
      "/payouts/status/by-reference": {
        get: {
          tags: ["Payouts"],
          summary: "Get payout status by reference",
          operationId: "getPayoutStatus",
          security: bearer,
          parameters: [
            { name: "reference", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": ok("Payout status", { type: "object" }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
          },
        },
      },
      "/payouts/{id}": {
        get: {
          tags: ["Payouts"],
          summary: "Get a payout by ID",
          operationId: "getPayout",
          security: bearer,
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": ok("Payout", {
              type: "object",
              properties: { payout: ref("Payout") },
            }),
            "401": resRef("Unauthorized"),
            "404": resRef("NotFound"),
          },
        },
      },

      // ------------------------------------------------------------------
      // Admin Auth
      // ------------------------------------------------------------------
      "/admin/auth/login": {
        post: {
          tags: ["Admin Auth"],
          summary: "Admin login",
          description:
            "Either `email` or `phone` must be provided. Rate limited to 10 requests per 5 minutes per IP+credential.",
          operationId: "adminLogin",
          requestBody: jsonBody({
            type: "object",
            properties: {
              email: { type: "string", format: "email" },
              phone: { type: "string", minLength: 7, maxLength: 20 },
              password: { type: "string", minLength: 1, maxLength: 72 },
            },
            required: ["password"],
          }),
          responses: {
            "200": ok("Login successful", ref("AuthTokens")),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
            "429": resRef("TooManyRequests"),
          },
        },
      },
      "/admin/auth/refresh": {
        post: {
          tags: ["Admin Auth"],
          summary: "Refresh an admin access token",
          operationId: "adminRefresh",
          requestBody: jsonBody({
            type: "object",
            properties: { refreshToken: { type: "string", minLength: 1 } },
            required: ["refreshToken"],
          }),
          responses: {
            "200": ok("New tokens", { type: "object" }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
          },
        },
      },
      "/admin/auth/logout": {
        post: {
          tags: ["Admin Auth"],
          summary: "Invalidate an admin refresh token",
          operationId: "adminLogout",
          requestBody: jsonBody({
            type: "object",
            properties: { refreshToken: { type: "string", minLength: 1 } },
            required: ["refreshToken"],
          }),
          responses: {
            "200": ok("Logged out", { type: "object" }),
            "400": resRef("BadRequest"),
          },
        },
      },
      "/admin/auth/me": {
        get: {
          tags: ["Admin Auth"],
          summary: "Get the authenticated admin's profile",
          operationId: "adminMe",
          security: bearer,
          responses: {
            "200": ok("Admin profile", {
              type: "object",
              properties: {
                admin: ref("Admin"),
                permissions: { type: "array", items: { type: "string" } },
              },
            }),
            "401": resRef("Unauthorized"),
            "403": resRef("Forbidden"),
          },
        },
      },
      // ------------------------------------------------------------------
      // Admin Management (requires ADMIN_MANAGE_ADMINS)
      // ------------------------------------------------------------------
      "/admin/admins": {
        get: {
          tags: ["Admin Management"],
          summary: "List admin accounts",
          operationId: "listAdmins",
          security: bearer,
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
            { name: "search", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": ok("Admins list", {
              type: "object",
              properties: {
                success: { type: "boolean" },
                admins: { type: "array", items: ref("Admin") },
              },
            }),
            "401": resRef("Unauthorized"),
            "403": resRef("Forbidden"),
          },
        },
        post: {
          tags: ["Admin Management"],
          summary: "Create an admin account",
          operationId: "createAdmin",
          security: bearer,
          requestBody: jsonBody({
            type: "object",
            properties: {
              firstName: { type: "string", minLength: 1, maxLength: 100 },
              lastName: { type: "string", minLength: 1, maxLength: 100 },
              email: { type: "string", format: "email" },
              phone: { type: "string", minLength: 7, maxLength: 20 },
              countryCode: { type: "string", minLength: 2, maxLength: 3 },
              role: {
                type: "string",
                enum: ["business_admin", "finance_admin", "super_admin"],
              },
              temporaryPassword: { type: "string", minLength: 8, maxLength: 72 },
            },
            required: ["firstName", "lastName", "email", "countryCode", "role", "temporaryPassword"],
          }),
          responses: {
            "201": ok("Admin created", {
              type: "object",
              properties: {
                success: { type: "boolean" },
                id: { type: "string", format: "uuid" },
              },
            }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
            "403": resRef("Forbidden"),
          },
        },
      },
      "/admin/admins/{id}": {
        get: {
          tags: ["Admin Management"],
          summary: "Get an admin account",
          operationId: "getAdmin",
          security: bearer,
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": ok("Admin", {
              type: "object",
              properties: {
                success: { type: "boolean" },
                admin: ref("Admin"),
              },
            }),
            "401": resRef("Unauthorized"),
            "403": resRef("Forbidden"),
            "404": resRef("NotFound"),
          },
        },
      },
      "/admin/admins/{id}/status": {
        patch: {
          tags: ["Admin Management"],
          summary: "Enable or disable an admin account",
          operationId: "updateAdminStatus",
          security: bearer,
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: jsonBody({
            type: "object",
            properties: { status: { type: "string", enum: ["active", "disabled"] } },
            required: ["status"],
          }),
          responses: {
            "200": ok("Status updated", { type: "object" }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
            "403": resRef("Forbidden"),
          },
        },
      },
      "/admin/admins/{id}/role": {
        patch: {
          tags: ["Admin Management"],
          summary: "Change an admin's role",
          operationId: "updateAdminRole",
          security: bearer,
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: jsonBody({
            type: "object",
            properties: {
              role: {
                type: "string",
                enum: ["business_admin", "finance_admin", "super_admin"],
              },
            },
            required: ["role"],
          }),
          responses: {
            "200": ok("Role updated", { type: "object" }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
            "403": resRef("Forbidden"),
          },
        },
      },
      "/admin/admins/{id}/sessions": {
        get: {
          tags: ["Admin Management"],
          summary: "List an admin's active sessions",
          operationId: "listAdminSessions",
          security: bearer,
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": ok("Sessions", {
              type: "object",
              properties: {
                success: { type: "boolean" },
                sessions: { type: "array", items: { type: "object" } },
              },
            }),
            "401": resRef("Unauthorized"),
            "403": resRef("Forbidden"),
          },
        },
      },
      "/admin/admins/{id}/sessions/revoke": {
        post: {
          tags: ["Admin Management"],
          summary: "Revoke all sessions for an admin",
          operationId: "revokeAdminSessions",
          security: bearer,
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": ok("Sessions revoked", { type: "object" }),
            "401": resRef("Unauthorized"),
            "403": resRef("Forbidden"),
          },
        },
      },

      // ------------------------------------------------------------------
      // Admin Payouts (requires ADMIN_MANAGE_PAYOUTS)
      // ------------------------------------------------------------------
      "/admin/payouts/otp/validate": {
        post: {
          tags: ["Admin Payouts"],
          summary: "Validate the Monnify disbursement OTP for a payout",
          operationId: "validatePayoutOtp",
          security: bearer,
          requestBody: jsonBody({
            type: "object",
            properties: {
              reference: { type: "string" },
              otp: { type: "string", description: "Also accepted as authorizationCode" },
              authorizationCode: { type: "string" },
            },
            required: ["reference"],
          }),
          responses: {
            "200": ok("OTP validated", {
              type: "object",
              properties: {
                success: { type: "boolean" },
                provider: { type: "object" },
              },
            }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
            "403": resRef("Forbidden"),
          },
        },
      },
      "/admin/payouts/otp/resend": {
        post: {
          tags: ["Admin Payouts"],
          summary: "Resend the Monnify disbursement OTP for a payout",
          operationId: "resendPayoutOtp",
          security: bearer,
          requestBody: jsonBody({
            type: "object",
            properties: { reference: { type: "string" } },
            required: ["reference"],
          }),
          responses: {
            "200": ok("OTP resent", {
              type: "object",
              properties: {
                success: { type: "boolean" },
                provider: { type: "object" },
              },
            }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
            "403": resRef("Forbidden"),
          },
        },
      },

      // ------------------------------------------------------------------
      // Admin Payments (requires ADMIN_VIEW_PAYMENTS)
      // ------------------------------------------------------------------
      "/admin/payments": {
        get: {
          tags: ["Admin Payments"],
          summary: "List payment transactions",
          operationId: "listAdminPayments",
          security: bearer,
          parameters: paginatedQuery({
            customerId: { type: "string", format: "uuid" },
            search: { type: "string", maxLength: 100 },
            country: { type: "string", minLength: 2, maxLength: 3 },
            currency: { type: "string", minLength: 3, maxLength: 3 },
            status: { type: "string", maxLength: 32 },
            type: { type: "string", maxLength: 32 },
            direction: { type: "string", enum: ["credit", "debit"] },
            provider: { type: "string", maxLength: 64 },
          }),
          responses: {
            "200": ok("Payments list", { type: "object" }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
            "403": resRef("Forbidden"),
          },
        },
      },
      "/admin/payments/{id}": {
        get: {
          tags: ["Admin Payments"],
          summary: "Get a payment transaction",
          operationId: "getAdminPayment",
          security: bearer,
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": ok("Payment", { type: "object" }),
            "401": resRef("Unauthorized"),
            "403": resRef("Forbidden"),
            "404": resRef("NotFound"),
          },
        },
      },

      // ------------------------------------------------------------------
      // Admin Bills (requires ADMIN_VIEW_BILLS)
      // ------------------------------------------------------------------
      "/admin/bills": {
        get: {
          tags: ["Admin Bills"],
          summary: "List bill payment transactions",
          operationId: "listAdminBills",
          security: bearer,
          parameters: paginatedQuery({
            customerId: { type: "string", format: "uuid" },
            search: { type: "string", maxLength: 100 },
            country: { type: "string", minLength: 2, maxLength: 3 },
            currency: { type: "string", minLength: 3, maxLength: 3 },
            status: { type: "string", maxLength: 32 },
            type: { type: "string", enum: ["airtime", "data"] },
            provider: { type: "string", maxLength: 64 },
          }),
          responses: {
            "200": ok("Bills list", { type: "object" }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
            "403": resRef("Forbidden"),
          },
        },
      },
      "/admin/bills/{id}": {
        get: {
          tags: ["Admin Bills"],
          summary: "Get a bill payment transaction",
          operationId: "getAdminBill",
          security: bearer,
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": ok("Bill", { type: "object" }),
            "401": resRef("Unauthorized"),
            "403": resRef("Forbidden"),
            "404": resRef("NotFound"),
          },
        },
      },

      // ------------------------------------------------------------------
      // Admin Dashboard
      // ------------------------------------------------------------------
      "/admin/dashboard/home": {
        get: {
          tags: ["Admin Dashboard"],
          summary: "Admin dashboard home summary",
          operationId: "adminDashboardHome",
          security: bearer,
          parameters: [
            { name: "from", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "to", in: "query", schema: { type: "string", format: "date-time" } },
          ],
          responses: {
            "200": ok("Summary", { type: "object" }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
            "403": resRef("Forbidden"),
          },
        },
      },

      // ------------------------------------------------------------------
      // Admin Customers
      // ------------------------------------------------------------------
      "/admin/customers": {
        get: {
          tags: ["Admin Customers"],
          summary: "List customers",
          operationId: "listCustomers",
          security: bearer,
          parameters: [
            { name: "search", in: "query", schema: { type: "string", minLength: 1, maxLength: 100 } },
            { name: "kycStatus", in: "query", schema: { type: "string", enum: ["verified", "failed", "pending"] } },
            { name: "status", in: "query", schema: { type: "string", enum: ["active", "disabled"] } },
            { name: "country", in: "query", schema: { type: "string", minLength: 2, maxLength: 3 } },
            { name: "currency", in: "query", schema: { type: "string", minLength: 3, maxLength: 3 } },
            { name: "from", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "to", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
            { name: "sort", in: "query", schema: { type: "string", enum: ["joinedAt", "name"], default: "joinedAt" } },
            { name: "order", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "desc" } },
          ],
          responses: {
            "200": ok("Customers list", { type: "object" }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
            "403": resRef("Forbidden"),
          },
        },
      },
      "/admin/customers/{customerId}": {
        get: {
          tags: ["Admin Customers"],
          summary: "Get a customer's detail",
          operationId: "getCustomer",
          security: bearer,
          parameters: [
            { name: "customerId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            "200": ok("Customer", {
              type: "object",
              properties: {
                success: { type: "boolean" },
                customer: { type: "object" },
              },
            }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
            "403": resRef("Forbidden"),
          },
        },
      },
      "/admin/customers/{customerId}/transactions": {
        get: {
          tags: ["Admin Customers"],
          summary: "List a customer's transactions",
          operationId: "listCustomerTransactions",
          security: bearer,
          parameters: [
            { name: "customerId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
            ...paginatedQuery({
              type: { type: "string", maxLength: 32 },
              status: { type: "string", maxLength: 32 },
              currency: { type: "string", minLength: 3, maxLength: 3 },
              minAmount: { type: "string", pattern: "^\\d+(?:\\.\\d{1,8})?$" },
              maxAmount: { type: "string", pattern: "^\\d+(?:\\.\\d{1,8})?$" },
            }),
          ],
          responses: {
            "200": ok("Transactions", { type: "object" }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
            "403": resRef("Forbidden"),
          },
        },
      },
      "/admin/customers/{customerId}/status": {
        patch: {
          tags: ["Admin Customers"],
          summary: "Enable or disable a customer account",
          operationId: "updateCustomerStatus",
          security: bearer,
          parameters: [
            { name: "customerId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          requestBody: jsonBody({
            type: "object",
            properties: {
              status: { type: "string", enum: ["active", "disabled"] },
              reason: { type: "string" },
            },
            required: ["status"],
          }),
          responses: {
            "200": ok("Status updated", { type: "object" }),
            "400": resRef("BadRequest"),
            "401": resRef("Unauthorized"),
            "403": resRef("Forbidden"),
          },
        },
      },
    },
  } as const;
}
