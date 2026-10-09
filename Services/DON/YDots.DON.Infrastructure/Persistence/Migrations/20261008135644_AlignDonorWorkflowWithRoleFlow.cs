using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YDots.DON.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AlignDonorWorkflowWithRoleFlow : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "escalated_at_utc",
                table: "don_follow_up_tasks",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "escalated_by_user_id",
                table: "don_follow_up_tasks",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "escalation_reason",
                table: "don_follow_up_tasks",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "attachment_name",
                table: "don_donor_interactions",
                type: "character varying(260)",
                maxLength: 260,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "direction",
                table: "don_donor_interactions",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "engagement_level",
                table: "don_donor_interactions",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "internal_notes",
                table: "don_donor_interactions",
                type: "character varying(3000)",
                maxLength: 3000,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "is_important",
                table: "don_donor_interactions",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "quality",
                table: "don_donor_interactions",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "don_donor_owner_changes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    donor_id = table.Column<Guid>(type: "uuid", nullable: false),
                    previous_owner_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    previous_owner_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    new_owner_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    new_owner_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    reason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    effective_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    assigned_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    is_bulk_route = table.Column<bool>(type: "boolean", nullable: false),
                    created_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    updated_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    updated_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_don_donor_owner_changes", x => x.id);
                    table.ForeignKey(
                        name: "fk_don_donor_owner_changes_don_donors_donor_id",
                        column: x => x.donor_id,
                        principalTable: "don_donors",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_don_donor_owner_changes_donor_effective",
                table: "don_donor_owner_changes",
                columns: new[] { "donor_id", "effective_at_utc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "don_donor_owner_changes");

            migrationBuilder.DropColumn(
                name: "escalated_at_utc",
                table: "don_follow_up_tasks");

            migrationBuilder.DropColumn(
                name: "escalated_by_user_id",
                table: "don_follow_up_tasks");

            migrationBuilder.DropColumn(
                name: "escalation_reason",
                table: "don_follow_up_tasks");

            migrationBuilder.DropColumn(
                name: "attachment_name",
                table: "don_donor_interactions");

            migrationBuilder.DropColumn(
                name: "direction",
                table: "don_donor_interactions");

            migrationBuilder.DropColumn(
                name: "engagement_level",
                table: "don_donor_interactions");

            migrationBuilder.DropColumn(
                name: "internal_notes",
                table: "don_donor_interactions");

            migrationBuilder.DropColumn(
                name: "is_important",
                table: "don_donor_interactions");

            migrationBuilder.DropColumn(
                name: "quality",
                table: "don_donor_interactions");
        }
    }
}
