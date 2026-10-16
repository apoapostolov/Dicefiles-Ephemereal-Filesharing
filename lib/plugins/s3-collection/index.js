"use strict";

const { S3Client, ListObjectsV2Command, GetObjectCommand } = require("@aws-sdk/client-s3");
const { defineCollector } = require("../collection/engine");

async function page({ config, connection, checkpoint, signal }) {
  const { settings, credentials } = connection;
  if (!settings.bucket || !settings.region || !Array.isArray(settings.prefixes) || !settings.prefixes.some(prefix => config.prefix.startsWith(prefix))) {
    throw Object.assign(new Error("The connection must grant a bucket, region and approved prefix. Ask the operator to review its read-only scope."), { retryable: false });
  }
  const client = connection.client || new S3Client({ region: settings.region, endpoint: settings.endpoint || undefined, forcePathStyle: !!settings.endpoint, credentials, maxAttempts: 2 });
  const response = await client.send(new ListObjectsV2Command({ Bucket: settings.bucket, Prefix: config.prefix, MaxKeys: 100, ContinuationToken: checkpoint.cursor || undefined }), { abortSignal: signal });
  const entries = (response.Contents || []).filter(item => item.Key && item.Key.startsWith(config.prefix) && !item.Key.endsWith("/")).map(item => ({
    id: item.Key, name: item.Key.split("/").pop(), size: item.Size, revision: `${item.ETag}:${item.LastModified?.toISOString() || ""}:${item.Size}`,
    async open() {
      const object = await client.send(new GetObjectCommand({ Bucket: settings.bucket, Key: item.Key, IfMatch: item.ETag, ChecksumMode: "ENABLED" }), { abortSignal: signal });
      return object.Body;
    },
  }));
  return { entries, checkpoint: { cursor: response.NextContinuationToken || "" }, hasMore: !!response.IsTruncated && !!response.NextContinuationToken };
}

module.exports = defineCollector({ id: "s3-collection", name: "S3 Collection", provider: "s3", description: "Collect revisions from an operator-approved, read-only bucket prefix.", required: ["connectionId"],
  properties: { connectionId: { type: "string", title: "Connection", connectionProvider: "s3" }, prefix: { type: "string", title: "Prefix", description: "Must remain inside the connection's approved prefixes" }, pollIntervalMinutes: { type: "number", minimum: 0, maximum: 10080, default: 60, title: "Scan interval" } }, page });
module.exports.page = page;
