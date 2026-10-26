-- The customer's BVN, encrypted (src/core/utils/seal.ts), kept only from submission until
-- their Moneta account is opened automatically after verification, then cleared.
alter table app.kyc_profiles add column if not exists bvn_sealed text;
