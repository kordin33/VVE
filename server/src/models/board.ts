export interface BoardRecord {
  id: string;
  organization_id: string | null;
  teacher_id: string;
  student_id: string | null;
  title: string | null;
  public_slug: string | null;
  /** Retrievable random Board Access token (VVE-101, ADR-0008 analogue). */
  student_token: string | null;
  student_token_hash: string | null;
  created_at: Date;
  valid_until: Date;
  archived_at: Date | null;
  deleted_at: Date | null;
  /** Durable Board Access credential version (VVE-102 rotates it). */
  access_credential_version: number;
  /** End Board Access timestamp; set ends access immediately (VVE-102 owns transitions). */
  access_ended_at: Date | null;
  /** Scheduled permanent deletion (VVE-102 owns transitions). */
  delete_after: Date | null;
}
