import type { Knex } from "knex";

/**
 * VVE-101 (slice S1): durable credential state for CapabilityAccess.
 *
 *  - `teacher_access_links`: exactly ONE active retrievable Teacher Access
 *    Link per teacher (ADR-0008 — plaintext token storage is accepted for the
 *    Pilot so the administration panel can display/copy the current link).
 *    A partial unique index enforces the single active link at the database
 *    level; superseded rows stay for audit with `is_active = false`.
 *  - `teachers.access_credential_version`: durable credential version. Every
 *    regeneration and deactivation atomically increments it, so sessions and
 *    links issued before the bump are denied immediately (they embed the
 *    version they were issued under).
 *  - `boards.student_token`: random stored Board Access token (replaces the
 *    deterministic HMAC(boardId:slug) derivation, which could not support
 *    regeneration). Retrievable storage keeps the Teacher dashboard able to
 *    display the link without rotating it.
 *  - `boards.access_credential_version`: same versioning contract for Board
 *    Access (consumed by VVE-102's regeneration command).
 *  - `boards.access_ended_at`, `boards.delete_after`: End Board Access and
 *    the deletion schedule (VVE-102 owns the lifecycle transitions;
 *    CapabilityAccess already denies on them so the columns exist now).
 */
export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable("teacher_access_links", (table) => {
        table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
        table.uuid("teacher_id").notNullable().references("id").inTable("teachers").onDelete("CASCADE");
        table.text("token").notNullable().unique();
        table.integer("credential_version").notNullable();
        table.boolean("is_active").notNullable().defaultTo(true);
        table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp("regenerated_at", { useTz: true });
        table.index(["teacher_id", "is_active"]);
    });

    // Exactly one active Teacher Access Link per teacher, enforced by the database.
    await knex.raw(
        "CREATE UNIQUE INDEX teacher_access_links_one_active_per_teacher ON teacher_access_links (teacher_id) WHERE is_active"
    );

    await knex.schema.alterTable("teachers", (table) => {
        table.integer("access_credential_version").notNullable().defaultTo(1);
    });

    await knex.schema.alterTable("boards", (table) => {
        table.text("student_token");
        table.integer("access_credential_version").notNullable().defaultTo(1);
        table.timestamp("access_ended_at", { useTz: true });
        table.timestamp("delete_after", { useTz: true });
    });

    // The deterministic student token hash is superseded by the random stored
    // token; the column stays (additive migration) but is no longer mandatory.
    await knex.raw("ALTER TABLE boards ALTER COLUMN student_token_hash DROP NOT NULL");
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw("ALTER TABLE boards ALTER COLUMN student_token_hash SET NOT NULL");
    await knex.schema.alterTable("boards", (table) => {
        table.dropColumn("delete_after");
        table.dropColumn("access_ended_at");
        table.dropColumn("access_credential_version");
        table.dropColumn("student_token");
    });

    await knex.schema.alterTable("teachers", (table) => {
        table.dropColumn("access_credential_version");
    });

    await knex.schema.dropTableIfExists("teacher_access_links");
}
