/*
  DPDP RAF database inspection (SQL Server)

  Run this script in SQL Server Management Studio or Azure Data Studio after
  connecting to the intended application database. It does not modify data.

  All table rows are returned by default. Set @MaxRowsPerTable to a positive
  number to limit each table's result set. Results may contain personal data
  and audit details; use an authorized account and do not share unprotected
  exports.
*/

SET NOCOUNT ON;

DECLARE @MaxRowsPerTable INT = NULL;

IF @MaxRowsPerTable IS NOT NULL AND @MaxRowsPerTable < 1
BEGIN
  ;THROW 50000, '@MaxRowsPerTable must be NULL or a positive integer.', 1;
END;

SELECT
  DB_NAME() AS database_name,
  SYSUTCDATETIME() AS inspected_at_utc,
  CAST(SERVERPROPERTY('ServerName') AS NVARCHAR(128)) AS server_name;

/* Tables and approximate row counts. */
SELECT
  schemas.name AS schema_name,
  tables.name AS table_name,
  SUM(CASE WHEN partitions.index_id IN (0, 1) THEN partitions.rows ELSE 0 END) AS approximate_row_count
FROM sys.tables AS tables
INNER JOIN sys.schemas AS schemas ON schemas.schema_id = tables.schema_id
LEFT JOIN sys.partitions AS partitions ON partitions.object_id = tables.object_id
WHERE tables.is_ms_shipped = 0
GROUP BY schemas.name, tables.name
ORDER BY schemas.name, tables.name;

/* Columns, SQL types, nullability, identity, computed, and default details. */
SELECT
  schemas.name AS schema_name,
  tables.name AS table_name,
  columns.column_id,
  columns.name AS column_name,
  types.name AS data_type,
  CASE
    WHEN types.name IN (N'nvarchar', N'nchar') AND columns.max_length <> -1 THEN columns.max_length / 2
    WHEN columns.max_length = -1 THEN -1
    ELSE columns.max_length
  END AS declared_length,
  columns.precision,
  columns.scale,
  columns.is_nullable,
  columns.is_identity,
  columns.is_computed,
  defaults.definition AS default_definition,
  computed.definition AS computed_definition
FROM sys.tables AS tables
INNER JOIN sys.schemas AS schemas ON schemas.schema_id = tables.schema_id
INNER JOIN sys.columns AS columns ON columns.object_id = tables.object_id
INNER JOIN sys.types AS types ON types.user_type_id = columns.user_type_id
LEFT JOIN sys.default_constraints AS defaults
  ON defaults.parent_object_id = columns.object_id
  AND defaults.parent_column_id = columns.column_id
LEFT JOIN sys.computed_columns AS computed
  ON computed.object_id = columns.object_id
  AND computed.column_id = columns.column_id
WHERE tables.is_ms_shipped = 0
ORDER BY schemas.name, tables.name, columns.column_id;

/* Primary keys, unique constraints, and indexes by indexed column. */
SELECT
  schemas.name AS schema_name,
  tables.name AS table_name,
  indexes.name AS index_name,
  indexes.is_primary_key,
  indexes.is_unique,
  indexes.is_unique_constraint,
  indexes.has_filter,
  indexes.filter_definition,
  index_columns.key_ordinal,
  index_columns.is_included_column,
  columns.name AS column_name,
  index_columns.is_descending_key
FROM sys.tables AS tables
INNER JOIN sys.schemas AS schemas ON schemas.schema_id = tables.schema_id
INNER JOIN sys.indexes AS indexes ON indexes.object_id = tables.object_id
INNER JOIN sys.index_columns AS index_columns
  ON index_columns.object_id = indexes.object_id
  AND index_columns.index_id = indexes.index_id
INNER JOIN sys.columns AS columns
  ON columns.object_id = index_columns.object_id
  AND columns.column_id = index_columns.column_id
WHERE tables.is_ms_shipped = 0
  AND indexes.name IS NOT NULL
ORDER BY schemas.name, tables.name, indexes.name, index_columns.key_ordinal, index_columns.index_column_id;

/* Foreign-key relationships, including composite-key column mappings. */
SELECT
  foreign_keys.name AS foreign_key_name,
  parent_schema.name AS parent_schema,
  parent_table.name AS parent_table,
  parent_column.name AS parent_column,
  referenced_schema.name AS referenced_schema,
  referenced_table.name AS referenced_table,
  referenced_column.name AS referenced_column,
  foreign_key_columns.constraint_column_id AS key_column_order,
  foreign_keys.update_referential_action_desc AS on_update,
  foreign_keys.delete_referential_action_desc AS on_delete,
  foreign_keys.is_disabled
FROM sys.foreign_keys AS foreign_keys
INNER JOIN sys.foreign_key_columns AS foreign_key_columns
  ON foreign_key_columns.constraint_object_id = foreign_keys.object_id
INNER JOIN sys.tables AS parent_table ON parent_table.object_id = foreign_key_columns.parent_object_id
INNER JOIN sys.schemas AS parent_schema ON parent_schema.schema_id = parent_table.schema_id
INNER JOIN sys.columns AS parent_column
  ON parent_column.object_id = foreign_key_columns.parent_object_id
  AND parent_column.column_id = foreign_key_columns.parent_column_id
INNER JOIN sys.tables AS referenced_table ON referenced_table.object_id = foreign_key_columns.referenced_object_id
INNER JOIN sys.schemas AS referenced_schema ON referenced_schema.schema_id = referenced_table.schema_id
INNER JOIN sys.columns AS referenced_column
  ON referenced_column.object_id = foreign_key_columns.referenced_object_id
  AND referenced_column.column_id = foreign_key_columns.referenced_column_id
ORDER BY parent_schema.name, parent_table.name, foreign_keys.name, foreign_key_columns.constraint_column_id;

/* Check constraints. */
SELECT
  schemas.name AS schema_name,
  tables.name AS table_name,
  checks.name AS check_name,
  checks.definition,
  checks.is_disabled
FROM sys.check_constraints AS checks
INNER JOIN sys.tables AS tables ON tables.object_id = checks.parent_object_id
INNER JOIN sys.schemas AS schemas ON schemas.schema_id = tables.schema_id
WHERE tables.is_ms_shipped = 0
ORDER BY schemas.name, tables.name, checks.name;

/*
  Return rows from every non-system table in the current database.
  SQL Server Management Studio displays one result grid per table.
*/
DECLARE @SchemaName SYSNAME;
DECLARE @TableName SYSNAME;
DECLARE @QualifiedTableName NVARCHAR(517);
DECLARE @SelectSql NVARCHAR(MAX);

DECLARE table_cursor CURSOR LOCAL FAST_FORWARD FOR
  SELECT schemas.name, tables.name
  FROM sys.tables AS tables
  INNER JOIN sys.schemas AS schemas ON schemas.schema_id = tables.schema_id
  WHERE tables.is_ms_shipped = 0
  ORDER BY schemas.name, tables.name;

OPEN table_cursor;
FETCH NEXT FROM table_cursor INTO @SchemaName, @TableName;

WHILE @@FETCH_STATUS = 0
BEGIN
  SET @QualifiedTableName = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@TableName);
  PRINT N'Table data: ' + @QualifiedTableName;

  IF @MaxRowsPerTable IS NULL
    SET @SelectSql = N'SELECT * FROM ' + @QualifiedTableName + N';';
  ELSE
    SET @SelectSql = N'SELECT TOP (' + CONVERT(NVARCHAR(12), @MaxRowsPerTable) + N') * FROM ' + @QualifiedTableName + N';';

  EXEC sys.sp_executesql @SelectSql;
  FETCH NEXT FROM table_cursor INTO @SchemaName, @TableName;
END;

CLOSE table_cursor;
DEALLOCATE table_cursor;