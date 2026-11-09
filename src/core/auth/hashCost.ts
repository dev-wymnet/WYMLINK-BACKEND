// bcrypt work factors. Each verification costs CPU on every sign-in and every PIN-approved
// payment, and a busy event can bring dozens at once to a small server.
//  - Customers: 10 (bcrypt's own default, within OWASP's guidance). PINs (4 digits) and
//    passcodes (6) are protected by attempt lockouts, not by hashing cost.
//  - Staff: 12 (few accounts, wide access).
// Existing hashes keep their own cost: bcrypt reads it from the hash when comparing.
export const CUSTOMER_HASH_COST = 10;
export const STAFF_HASH_COST = 12;
