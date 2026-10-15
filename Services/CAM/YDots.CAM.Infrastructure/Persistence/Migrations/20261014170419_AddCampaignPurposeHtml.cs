using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YDots.CAM.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCampaignPurposeHtml : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "purpose_html",
                table: "cam_campaigns",
                type: "character varying(8000)",
                maxLength: 8000,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "purpose_html",
                table: "cam_campaigns");
        }
    }
}
