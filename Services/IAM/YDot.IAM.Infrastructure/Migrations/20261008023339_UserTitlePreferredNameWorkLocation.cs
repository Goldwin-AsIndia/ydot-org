using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YDot.IAM.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class UserTitlePreferredNameWorkLocation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "preferred_name",
                table: "iam_users",
                type: "character varying(160)",
                maxLength: 160,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "title",
                table: "iam_users",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "work_location",
                table: "iam_users",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "preferred_name",
                table: "iam_users");

            migrationBuilder.DropColumn(
                name: "title",
                table: "iam_users");

            migrationBuilder.DropColumn(
                name: "work_location",
                table: "iam_users");
        }
    }
}
