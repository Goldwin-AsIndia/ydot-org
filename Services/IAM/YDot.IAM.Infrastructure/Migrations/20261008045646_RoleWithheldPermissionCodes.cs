using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YDot.IAM.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class RoleWithheldPermissionCodes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string[]>(
                name: "withheld_permission_codes",
                table: "iam_roles",
                type: "text[]",
                nullable: false,
                defaultValueSql: "'{}'::text[]");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "withheld_permission_codes",
                table: "iam_roles");
        }
    }
}
