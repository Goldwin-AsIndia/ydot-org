using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YDot.PAY.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddTrackingPlaceAttribution : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "tracking_asset_place_id",
                table: "pay_donations",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "tracking_place_name",
                table: "pay_donations",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "tracking_asset_place_id",
                table: "pay_donation_intents",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "tracking_place_name",
                table: "pay_donation_intents",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_pay_donations_tenant_tracking_asset",
                table: "pay_donations",
                columns: new[] { "tenant_id", "tracking_asset_id" },
                filter: "tracking_asset_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_pay_donations_tenant_tracking_place",
                table: "pay_donations",
                columns: new[] { "tenant_id", "tracking_asset_place_id" },
                filter: "tracking_asset_place_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_pay_donation_intents_tracking_asset",
                table: "pay_donation_intents",
                column: "tracking_asset_id",
                filter: "tracking_asset_id IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_pay_donations_tenant_tracking_asset",
                table: "pay_donations");

            migrationBuilder.DropIndex(
                name: "ix_pay_donations_tenant_tracking_place",
                table: "pay_donations");

            migrationBuilder.DropIndex(
                name: "ix_pay_donation_intents_tracking_asset",
                table: "pay_donation_intents");

            migrationBuilder.DropColumn(
                name: "tracking_asset_place_id",
                table: "pay_donations");

            migrationBuilder.DropColumn(
                name: "tracking_place_name",
                table: "pay_donations");

            migrationBuilder.DropColumn(
                name: "tracking_asset_place_id",
                table: "pay_donation_intents");

            migrationBuilder.DropColumn(
                name: "tracking_place_name",
                table: "pay_donation_intents");
        }
    }
}
