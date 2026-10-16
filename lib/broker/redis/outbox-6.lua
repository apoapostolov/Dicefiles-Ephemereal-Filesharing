local jobs, due, dead, seen, deadjobs, bytes = unpack(KEYS)
local op, now, id, value = ARGV[1], tonumber(ARGV[2]), ARGV[3], ARGV[4]
if op == 'enqueue' then
  redis.call('ZREMRANGEBYSCORE', seen, '-inf', now - 86400000)
  if redis.call('ZSCORE', seen, id) or redis.call('HEXISTS', jobs, id) == 1 then return 0 end
  if #value > 262144 or redis.call('ZCARD', due) >= 10000 or tonumber(redis.call('GET', bytes) or '0') + #value > 33554432 then return -1 end
  local wrapped = cjson.encode({owner='', value=value})
  redis.call('HSET', jobs, id, wrapped)
  redis.call('INCRBY', bytes, #wrapped)
  redis.call('ZADD', due, tonumber(ARGV[5]) or now, id)
  redis.call('ZADD', seen, now, id)
  redis.call('ZREMRANGEBYRANK', seen, 0, -20001)
  return 1
elseif op == 'claim' then
  local ids = redis.call('ZRANGEBYSCORE', due, '-inf', now, 'LIMIT', 0, 1)
  if #ids == 0 then return nil end
  id = ids[1]
  local raw = redis.call('HGET', jobs, id)
  if not raw then redis.call('ZREM', due, id) return nil end
  local job = cjson.decode(raw)
  job.owner = value
  local updated = cjson.encode(job)
  redis.call('INCRBY', bytes, #updated - #raw)
  redis.call('HSET', jobs, id, updated)
  redis.call('ZADD', due, now + tonumber(ARGV[5]), id)
  return updated
elseif op == 'get' then
  return redis.call('HGET', jobs, id) or redis.call('HGET', deadjobs, id)
elseif op == 'list' then
  local options = cjson.decode(value)
  local limit = math.max(1, math.min(50, tonumber(options.limit) or 20))
  local cursor = math.max(0, tonumber(options.cursor) or 0)
  local active = redis.call('ZCARD', due)
  local total = active + redis.call('ZCARD', dead)
  local rows = {}
  local scanned = 0
  while cursor < total and #rows < limit and scanned < 1000 do
    local current = cursor < active and redis.call('ZRANGE', due, cursor, cursor) or redis.call('ZREVRANGE', dead, cursor - active, cursor - active)
    if #current > 0 then
      local encoded = redis.call('HGET', cursor < active and jobs or deadjobs, current[1])
      if encoded then
        local record = cjson.decode(encoded)
        local item = record.value and cjson.decode(record.value) or record
        if (not options.roomId or item.roomId == options.roomId) and (not options.pluginId or item.pluginId == options.pluginId) and (options.global == nil or item.global == options.global) then
          item.status = item.status or (record.owner ~= '' and record.owner ~= nil and 'running' or (tonumber(item.attempt or 0) > 0 and 'retrying' or 'queued'))
          item.dueAt = tonumber(redis.call('ZSCORE', due, current[1]))
          item.owner = nil
          table.insert(rows, item)
        end
      end
    end
    cursor = cursor + 1; scanned = scanned + 1
  end
  return cjson.encode({records=rows, nextCursor=cursor < total and tostring(cursor) or cjson.null})
elseif op == 'cancel' then
  local raw = redis.call('HGET', jobs, id)
  if not raw then return 0 end
  local record = cjson.decode(cjson.decode(raw).value)
  record.status = 'cancelled'; record.finishedAt = now; record.owner = nil
  redis.call('HSET', deadjobs, id, cjson.encode(record))
  redis.call('ZADD', dead, now, id)
  redis.call('HDEL', jobs, id); redis.call('ZREM', due, id); redis.call('INCRBY', bytes, -#raw)
  local old = redis.call('ZRANGE', dead, 0, -201)
  for _, k in ipairs(old) do redis.call('HDEL', deadjobs, k) redis.call('ZREM', dead, k) end
  return 1
elseif op == 'replay' then
  if redis.call('HEXISTS', jobs, id) == 1 then return 0 end
  local raw = redis.call('HGET', deadjobs, id)
  if not raw or redis.call('ZCARD', due) >= 10000 then return 0 end
  local record = cjson.decode(raw)
  if record.status == 'completed' then return 0 end
  local wrapped = cjson.encode({owner='', value=value})
  if #value > 262144 or tonumber(redis.call('GET', bytes) or '0') + #wrapped > 33554432 then return -1 end
  redis.call('HSET', jobs, id, wrapped); redis.call('INCRBY', bytes, #wrapped)
  redis.call('ZADD', due, now, id); redis.call('HDEL', deadjobs, id); redis.call('ZREM', dead, id)
  return 1
end
local raw = redis.call('HGET', jobs, id)
if not raw then return 0 end
local job = cjson.decode(raw)
if job.owner ~= value then return 0 end
if op == 'renew' then
  redis.call('ZADD', due, now + tonumber(ARGV[5]), id)
  return 1
end
if op == 'retry' then
  local updated = cjson.encode({owner='', value=ARGV[5]})
  redis.call('INCRBY', bytes, #updated - #raw)
  redis.call('HSET', jobs, id, updated)
  redis.call('ZADD', due, tonumber(ARGV[6]), id)
  return 1
elseif op == 'dead' or op == 'finish' then
  redis.call('HSET', deadjobs, id, ARGV[5])
  redis.call('ZADD', dead, now, id)
  local old = redis.call('ZRANGE', dead, 0, -201)
  for _, k in ipairs(old) do redis.call('HDEL', deadjobs, k) redis.call('ZREM', dead, k) end
end
redis.call('HDEL', jobs, id)
redis.call('ZREM', due, id)
redis.call('INCRBY', bytes, -#raw)
return 1
