"use strict";

// JS mirror of migrations/20260829000000_capability_access.ts for the Docker
// runtime (see src/db.ts). Keep both files in sync.

exports.up = async function (knex) {
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
};

exports.down = async function (knex) {
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
};
