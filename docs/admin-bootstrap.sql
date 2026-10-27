USE [DETECTOR_APP];
GO

DECLARE @initialEcode NVARCHAR(32) = N'm07476';

IF NOT EXISTS (SELECT 1 FROM dbo.user_profiles WHERE ecode = @initialEcode)
  THROW 50001, 'The initial admin manager must already have a user profile.', 1;

SET XACT_ABORT ON;
BEGIN TRANSACTION;

BEGIN TRY
  IF NOT EXISTS (
    SELECT 1 FROM dbo.user_roles WITH (UPDLOCK, HOLDLOCK)
    WHERE ecode = @initialEcode AND role_name = N'ADMIN_MANAGER' AND revoked_at IS NULL
  )
  BEGIN
    INSERT INTO dbo.user_roles (ecode, role_name)
    VALUES (@initialEcode, N'ADMIN_MANAGER');

    INSERT INTO dbo.user_role_audit (ecode, role_name, action, reason)
    VALUES (@initialEcode, N'ADMIN_MANAGER', N'BOOTSTRAP_ASSIGNED', N'Initial administrator bootstrap');
  END;
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
GO