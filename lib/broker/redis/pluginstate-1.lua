-- One private namespace; each value is encoded JSON to preserve null/array types.
local operation = ARGV[1]
local key = ARGV[2]
local input = cjson.decode(ARGV[3])
local raw = redis.call('GET', KEYS[1])
local entries = raw and cjson.decode(raw) or {}
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local count = 0
local latest = now
for name, row in pairs(entries) do
  if row.expiresAt <= now then entries[name] = nil
  else count = count + 1; latest = math.max(latest, row.expiresAt) end
end
if operation == 'set' or operation == 'delete' then
  local previous = entries[key]
  local version = previous and previous.version or ''
  if input.checkVersion and version ~= input.expectedVersion then
    return cjson.encode({error='CONFLICT'})
  end
  if operation == 'delete' then
    entries[key] = nil
    if not next(entries) then redis.call('DEL', KEYS[1])
    else redis.call('SET', KEYS[1], cjson.encode(entries), 'PX', math.max(1, latest - now)) end
    return cjson.encode({deleted=previous ~= nil})
  end
  local row = {valueJson=input.valueJson, version=input.version, updatedAt=now, expiresAt=now + input.ttlSeconds * 1000}
  entries[key] = row
  local encoded = cjson.encode(entries)
  if (not previous and count >= 256) or string.len(encoded) > 262144 then
    return cjson.encode({error='LIMIT'})
  end
  latest = math.max(latest, row.expiresAt)
  redis.call('SET', KEYS[1], encoded, 'PX', math.max(1, latest - now))
  return cjson.encode({row=row})
end
if operation == 'get' then return cjson.encode({row=entries[key] or cjson.null}) end
return cjson.encode({entries=entries})
