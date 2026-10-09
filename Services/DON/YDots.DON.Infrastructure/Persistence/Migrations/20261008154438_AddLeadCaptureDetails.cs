using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YDots.DON.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddLeadCaptureDetails : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "address_line",
                table: "don_leads",
                type: "character varying(250)",
                maxLength: 250,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "alternate_mobile_numbers",
                table: "don_leads",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "country",
                table: "don_leads",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "display_name",
                table: "don_leads",
                type: "character varying(150)",
                maxLength: 150,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "address_line",
                table: "don_leads");

            migrationBuilder.DropColumn(
                name: "alternate_mobile_numbers",
                table: "don_leads");

            migrationBuilder.DropColumn(
                name: "country",
                table: "don_leads");

            migrationBuilder.DropColumn(
                name: "display_name",
                table: "don_leads");
        }
    }
}
