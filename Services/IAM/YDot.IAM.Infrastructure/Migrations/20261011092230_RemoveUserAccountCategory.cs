using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YDot.IAM.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class RemoveUserAccountCategory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // THE ACCOUNT CATEGORY IS GONE. Its one job was to give a "DonorPortal" account the
            // DONOR role when none was named; roles now say what kind of account it is, and PAY
            // names DONOR by code. Nothing else read the column - the JWT claim it fed had no
            // consumer - and DON's staff picker already narrows on the role's permissions.
            migrationBuilder.DropColumn(
                name: "account_category",
                table: "iam_users");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "account_category",
                table: "iam_users",
                type: "character varying(80)",
                maxLength: 80,
                nullable: false,
                defaultValue: "Employee");

            // Rebuilt from the role that replaced it, so a rollback leaves donors marked as donors.
            migrationBuilder.Sql("""
                UPDATE iam_users u
                   SET account_category = 'DonorPortal'
                 WHERE EXISTS (SELECT 1
                                 FROM iam_user_roles ur
                                 JOIN iam_roles r ON r.id = ur.role_id
                                WHERE ur.user_id = u.id
                                  AND r.code = 'DONOR');
                """);
        }
    }
}
