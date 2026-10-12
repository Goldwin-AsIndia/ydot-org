using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YDot.IAM.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class RemoveUserEngagementType : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // THE ENGAGEMENT TYPE IS GONE (full-time, part-time, contract, volunteer, intern,
            // external), removed by request with its dropdown on Create User. Its one effect was
            // to make the employee number required for full-time and part-time staff; that number
            // is now optional for everybody. PAY no longer sends one for a donor account.
            migrationBuilder.DropColumn(
                name: "engagement_type",
                table: "iam_users");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // The old default, which is what every account created without one got.
            migrationBuilder.AddColumn<string>(
                name: "engagement_type",
                table: "iam_users",
                type: "character varying(80)",
                maxLength: 80,
                nullable: false,
                defaultValue: "FullTime");

            // Donor accounts were always External, so a rollback marks them so again. Contract,
            // volunteer and intern cannot be recovered - nothing else recorded them.
            migrationBuilder.Sql("""
                UPDATE iam_users u
                   SET engagement_type = 'External'
                 WHERE EXISTS (SELECT 1
                                 FROM iam_user_roles ur
                                 JOIN iam_roles r ON r.id = ur.role_id
                                WHERE ur.user_id = u.id
                                  AND r.code = 'DONOR');
                """);
        }
    }
}
