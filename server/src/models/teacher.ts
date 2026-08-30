export interface TeacherRecord {
  id: string;
  organization_id: string | null;
  email: string;
  full_name: string | null;
  is_active: boolean;
  created_at: Date;
  last_login_at: Date | null;
  permanent_token_hash: string | null;
  /** Durable credential version (VVE-101): bumped on regeneration/deactivation. */
  access_credential_version: number;
}

export interface TeacherAccessLinkRecord {
  id: string;
  teacher_id: string;
  /** Retrievable token (ADR-0008). */
  token: string;
  credential_version: number;
  is_active: boolean;
  created_at: Date;
  regenerated_at: Date | null;
}

export interface BoardAccessLogRecord {
  id?: number;
  board_id: string | null;
  actor_type: 'teacher' | 'student';
  actor_id: string | null;
  at?: Date;
  ip_addr: string | null;
  user_agent: string | null;
}
