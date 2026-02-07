/**
 * Credential Vault Service
 *
 * Encrypted storage and retrieval of site credentials.
 * Replaces direct user_credentials queries with structured vault access.
 */

import { getSupabaseClient } from "../utils/supabase.js";
import { encryptWithServerKey, decryptWithServerKey } from "../security/encryption.js";

interface StoredCredential {
  username: string;
  password: string;
  tfaMethod?: string;
}

/**
 * Store credentials in the vault (encrypted).
 */
export async function storeCredential(
  userId: string,
  siteDomain: string,
  username: string,
  password: string,
  tfaMethod?: string
): Promise<void> {
  const usernameEncrypted = await encryptWithServerKey(username);
  const passwordEncrypted = await encryptWithServerKey(password);

  await getSupabaseClient()
    .from("credential_vault")
    .upsert(
      {
        user_id: userId,
        site_domain: siteDomain,
        username_encrypted: usernameEncrypted,
        password_encrypted: passwordEncrypted,
        tfa_method: tfaMethod || "none",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,site_domain" }
    );

  console.log(`[VAULT] Stored credentials for ${siteDomain}`);
}

/**
 * Get decrypted credentials from the vault.
 */
export async function getCredential(
  userId: string,
  siteDomain: string
): Promise<StoredCredential | null> {
  try {
    const { data } = await getSupabaseClient()
      .from("credential_vault")
      .select("username_encrypted, password_encrypted, tfa_method")
      .eq("user_id", userId)
      .eq("site_domain", siteDomain)
      .single();

    if (!data) return null;

    const username = await decryptWithServerKey(data.username_encrypted);
    const password = await decryptWithServerKey(data.password_encrypted);

    // Update last_used_at
    await getSupabaseClient()
      .from("credential_vault")
      .update({ last_used_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("site_domain", siteDomain);

    return {
      username,
      password,
      tfaMethod: data.tfa_method || undefined,
    };
  } catch (error) {
    console.error(`[VAULT] Failed to get credential for ${siteDomain}:`, error);
    return null;
  }
}

/**
 * List all stored credential domains for a user (domain names only, no secrets).
 */
export async function listCredentials(
  userId: string
): Promise<string[]> {
  try {
    const { data } = await getSupabaseClient()
      .from("credential_vault")
      .select("site_domain")
      .eq("user_id", userId);

    return (data || []).map(row => row.site_domain);
  } catch (error) {
    console.error(`[VAULT] Failed to list credentials:`, error);
    return [];
  }
}

/**
 * Delete credentials for a specific domain.
 */
export async function deleteCredential(
  userId: string,
  siteDomain: string
): Promise<boolean> {
  try {
    const { error } = await getSupabaseClient()
      .from("credential_vault")
      .delete()
      .eq("user_id", userId)
      .eq("site_domain", siteDomain);

    if (error) {
      console.error(`[VAULT] Failed to delete credential for ${siteDomain}:`, error);
      return false;
    }

    console.log(`[VAULT] Deleted credentials for ${siteDomain}`);
    return true;
  } catch (error) {
    console.error(`[VAULT] Failed to delete credential for ${siteDomain}:`, error);
    return false;
  }
}

/**
 * Update 2FA status for a site (e.g., after switching to Twilio number).
 */
export async function updateTfaStatus(
  userId: string,
  siteDomain: string,
  switchedToTwilio: boolean
): Promise<void> {
  try {
    await getSupabaseClient()
      .from("credential_vault")
      .update({
        twilio_switched: switchedToTwilio,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("site_domain", siteDomain);
  } catch (error) {
    console.error(`[VAULT] Failed to update 2FA status for ${siteDomain}:`, error);
  }
}
