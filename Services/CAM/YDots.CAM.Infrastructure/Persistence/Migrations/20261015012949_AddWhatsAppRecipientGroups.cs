using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YDots.CAM.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddWhatsAppRecipientGroups : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "cam_whatsapp_recipient_groups",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    campaign_id = table.Column<Guid>(type: "uuid", nullable: true),
                    tags = table.Column<List<string>>(type: "text[]", nullable: false),
                    created_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    updated_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    created_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    updated_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    updated_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    version = table.Column<long>(type: "bigint", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    business_unit_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_cam_whatsapp_recipient_groups", x => x.id);
                    table.ForeignKey(
                        name: "fk_cam_whatsapp_recipient_groups_cam_campaigns_campaign_id",
                        column: x => x.campaign_id,
                        principalTable: "cam_campaigns",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                },
                comment: "Named, tagged sets of WhatsApp-verified numbers kept for sends from the WhatsApp Messages page.");

            migrationBuilder.CreateTable(
                name: "cam_whatsapp_recipient_group_members",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    business_unit_id = table.Column<Guid>(type: "uuid", nullable: false),
                    group_id = table.Column<Guid>(type: "uuid", nullable: false),
                    phone_e164 = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    source_job_id = table.Column<Guid>(type: "uuid", nullable: true),
                    source_job_number = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    contact_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    added_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    added_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    added_by_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_cam_whatsapp_recipient_group_members", x => x.id);
                    table.ForeignKey(
                        name: "fk_cam_whatsapp_recipient_group_members_cam_whatsapp_recipient",
                        column: x => x.group_id,
                        principalTable: "cam_whatsapp_recipient_groups",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                },
                comment: "The numbers of a recipient group, each with the CheckNumber check job it was picked from.");

            migrationBuilder.CreateIndex(
                name: "ix_cam_whatsapp_recipient_group_members_group_phone",
                table: "cam_whatsapp_recipient_group_members",
                columns: new[] { "group_id", "phone_e164" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_cam_whatsapp_recipient_group_members_tenant_phone",
                table: "cam_whatsapp_recipient_group_members",
                columns: new[] { "tenant_id", "phone_e164" });

            migrationBuilder.CreateIndex(
                name: "ix_cam_whatsapp_recipient_groups_campaign",
                table: "cam_whatsapp_recipient_groups",
                column: "campaign_id");

            migrationBuilder.CreateIndex(
                name: "ix_cam_whatsapp_recipient_groups_tenant_name",
                table: "cam_whatsapp_recipient_groups",
                columns: new[] { "tenant_id", "name" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "cam_whatsapp_recipient_group_members");

            migrationBuilder.DropTable(
                name: "cam_whatsapp_recipient_groups");
        }
    }
}
