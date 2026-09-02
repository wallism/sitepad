using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace Sitepad.Api;

public sealed record LedgerResult(int StatusCode, string Json, string Outcome, bool Replayed);

public sealed class OperationLedger
{
    private const int MaxBusyAttempts = 4;
    private readonly string connectionString;
    private readonly ILogger<OperationLedger> logger;

    public OperationLedger(
        IConfiguration configuration,
        IHostEnvironment environment,
        ILogger<OperationLedger> logger)
    {
        var configuredPath = configuration["Sitepad:DatabasePath"] ?? "sitepad.db";
        var path = Path.IsPathRooted(configuredPath)
            ? configuredPath
            : Path.Combine(environment.ContentRootPath, configuredPath);
        connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = path,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Shared,
            DefaultTimeout = 2,
        }.ToString();
        this.logger = logger;
        Initialize();
    }

    public static byte[] CanonicalBytes(ValidatedSyncRequest request)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteString("operationId", request.OperationId);
            writer.WriteString("inspectionId", request.InspectionId);
            writer.WriteNumber("baseVersion", request.BaseVersion);
            WriteSnapshot(writer, "base", request.Base);
            WriteSnapshot(writer, "mine", request.Mine);
            writer.WriteEndObject();
        }
        return stream.ToArray();
    }

    public LedgerResult Apply(ValidatedSyncRequest request, bool rejectForDevelopment = false)
    {
        var fingerprint = Convert.ToHexString(SHA256.HashData(CanonicalBytes(request)));
        for (var attempt = 1; attempt <= MaxBusyAttempts; attempt++)
        {
            try
            {
                return ApplyOnce(request, fingerprint, rejectForDevelopment);
            }
            catch (SqliteException exception) when (
                exception.SqliteErrorCode is 5 or 6 && attempt < MaxBusyAttempts)
            {
                logger.LogWarning(
                    "SQLite busy retry {Attempt} for operation {OperationId}",
                    attempt,
                    request.OperationId);
                Thread.Sleep(attempt * 15);
            }
            catch (SqliteException exception) when (exception.SqliteErrorCode is 5 or 6)
            {
                logger.LogWarning(
                    "SQLite busy retries exhausted for operation {OperationId}",
                    request.OperationId);
                return JsonResult(
                    503,
                    new
                    {
                        kind = "retryable",
                        operationId = request.OperationId,
                        code = "database_busy",
                    },
                    "retryable");
            }
        }

        throw new InvalidOperationException("Unreachable busy retry state.");
    }

    public void Reset()
    {
        using var connection = Open();
        using var transaction = connection.BeginTransaction(deferred: false);
        Execute(connection, transaction, "DELETE FROM operations;");
        Execute(connection, transaction, "DELETE FROM inspections;");
        SeedInspection(connection, transaction);
        transaction.Commit();
    }

    private LedgerResult ApplyOnce(
        ValidatedSyncRequest request,
        string fingerprint,
        bool rejectForDevelopment)
    {
        using var connection = Open();
        using var transaction = connection.BeginTransaction(deferred: false);

        var stored = ReadOperation(connection, transaction, request.OperationId);
        if (stored is not null)
        {
            transaction.Commit();
            if (!CryptographicOperations.FixedTimeEquals(
                    Convert.FromHexString(stored.Value.Fingerprint),
                    Convert.FromHexString(fingerprint)))
            {
                return JsonResult(
                    422,
                    new
                    {
                        kind = "rejected",
                        operationId = request.OperationId,
                        code = "operation_id_reused",
                        message = "This operation ID was already used for different content.",
                    },
                    "rejected");
            }

            return new(stored.Value.StatusCode, stored.Value.Json, stored.Value.Outcome, true);
        }

        var inspection = ReadInspection(connection, transaction, request.InspectionId)
            ?? throw new InvalidOperationException("Validated fixture was not seeded.");

        if (rejectForDevelopment || inspection.Closed)
        {
            var rejected = JsonResult(
                422,
                new
                {
                    kind = "rejected",
                    operationId = request.OperationId,
                    code = "inspection_closed",
                    message = "The office closed this inspection.",
                },
                "rejected");
            InsertOperation(connection, transaction, request.OperationId, fingerprint, rejected);
            transaction.Commit();
            return rejected;
        }

        if (inspection.Version != request.BaseVersion)
        {
            var conflict = JsonResult(
                409,
                new
                {
                    kind = "conflict",
                    operationId = request.OperationId,
                    serverVersion = inspection.Version,
                    server = new { result = inspection.Result, note = inspection.Note },
                },
                "conflict");
            InsertOperation(connection, transaction, request.OperationId, fingerprint, conflict);
            transaction.Commit();
            return conflict;
        }

        var serverVersion = inspection.Version + 1;
        using (var update = connection.CreateCommand())
        {
            update.Transaction = transaction;
            update.CommandText = """
                UPDATE inspections
                SET version = $version, result = $result, note = $note
                WHERE inspection_id = $inspectionId;
                """;
            update.Parameters.AddWithValue("$version", serverVersion);
            update.Parameters.AddWithValue("$result", request.Mine.Result);
            update.Parameters.AddWithValue("$note", request.Mine.Note);
            update.Parameters.AddWithValue("$inspectionId", request.InspectionId);
            update.ExecuteNonQuery();
        }

        var acknowledged = JsonResult(
            200,
            new
            {
                kind = "acknowledged",
                operationId = request.OperationId,
                serverVersion,
                server = new { result = request.Mine.Result, note = request.Mine.Note },
            },
            "acknowledged");
        InsertOperation(connection, transaction, request.OperationId, fingerprint, acknowledged);
        transaction.Commit();
        return acknowledged;
    }

    private void Initialize()
    {
        var directory = Path.GetDirectoryName(
            new SqliteConnectionStringBuilder(connectionString).DataSource);
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        using var connection = Open();
        Execute(connection, null, """
            CREATE TABLE IF NOT EXISTS inspections (
                inspection_id TEXT PRIMARY KEY,
                version INTEGER NOT NULL,
                result TEXT NOT NULL,
                note TEXT NOT NULL,
                closed INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS operations (
                operation_id TEXT PRIMARY KEY,
                fingerprint TEXT NOT NULL,
                response_json TEXT NOT NULL,
                status_code INTEGER NOT NULL,
                outcome TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """);
        using var transaction = connection.BeginTransaction(deferred: false);
        SeedInspection(connection, transaction);
        transaction.Commit();
    }

    private static void SeedInspection(SqliteConnection connection, SqliteTransaction transaction)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT OR IGNORE INTO inspections (inspection_id, version, result, note, closed)
            VALUES ($inspectionId, 1, 'unanswered', '', 0);
            """;
        command.Parameters.AddWithValue("$inspectionId", SyncRequestValidator.KnownInspectionId);
        command.ExecuteNonQuery();
    }

    private SqliteConnection Open()
    {
        var connection = new SqliteConnection(connectionString);
        connection.Open();
        using var pragma = connection.CreateCommand();
        pragma.CommandText = "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2000;";
        pragma.ExecuteNonQuery();
        return connection;
    }

    private static (string Fingerprint, string Json, int StatusCode, string Outcome)? ReadOperation(
        SqliteConnection connection,
        SqliteTransaction transaction,
        string operationId)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            SELECT fingerprint, response_json, status_code, outcome
            FROM operations
            WHERE operation_id = $operationId;
            """;
        command.Parameters.AddWithValue("$operationId", operationId);
        using var reader = command.ExecuteReader();
        return reader.Read()
            ? (reader.GetString(0), reader.GetString(1), reader.GetInt32(2), reader.GetString(3))
            : null;
    }

    private static (long Version, string Result, string Note, bool Closed)? ReadInspection(
        SqliteConnection connection,
        SqliteTransaction transaction,
        string inspectionId)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            SELECT version, result, note, closed
            FROM inspections
            WHERE inspection_id = $inspectionId;
            """;
        command.Parameters.AddWithValue("$inspectionId", inspectionId);
        using var reader = command.ExecuteReader();
        return reader.Read()
            ? (reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.GetBoolean(3))
            : null;
    }

    private static void InsertOperation(
        SqliteConnection connection,
        SqliteTransaction transaction,
        string operationId,
        string fingerprint,
        LedgerResult result)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO operations (
                operation_id, fingerprint, response_json, status_code, outcome, created_at)
            VALUES ($operationId, $fingerprint, $json, $statusCode, $outcome, $createdAt);
            """;
        command.Parameters.AddWithValue("$operationId", operationId);
        command.Parameters.AddWithValue("$fingerprint", fingerprint);
        command.Parameters.AddWithValue("$json", result.Json);
        command.Parameters.AddWithValue("$statusCode", result.StatusCode);
        command.Parameters.AddWithValue("$outcome", result.Outcome);
        command.Parameters.AddWithValue("$createdAt", DateTimeOffset.UtcNow.ToString("O"));
        command.ExecuteNonQuery();
    }

    private static void Execute(
        SqliteConnection connection,
        SqliteTransaction? transaction,
        string sql)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }

    private static void WriteSnapshot(
        Utf8JsonWriter writer,
        string propertyName,
        DeliverySnapshotDto snapshot)
    {
        writer.WritePropertyName(propertyName);
        writer.WriteStartObject();
        writer.WriteString("result", snapshot.Result);
        writer.WriteString("note", snapshot.Note);
        writer.WriteEndObject();
    }

    private static LedgerResult JsonResult(
        int statusCode,
        object body,
        string outcome) =>
        new(
            statusCode,
            JsonSerializer.Serialize(body),
            outcome,
            false);
}
