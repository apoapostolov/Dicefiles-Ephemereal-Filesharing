local jobs, due, dead, seen, deadjobs, bytes = unpack(KEYS)
local op, now, id, value = ARGV[1], tonumber(ARGV[2]), ARGV[3], ARGV[4]
if op == 'enqueue' then
  redis.call('ZREMRANGEBYSCORE', seen, '-inf', now - 86400000)
  if redis.call('ZSCORE', seen, id) then return 0 end
  if #value > 262144 or redis.call('ZCARD', due) >= 10000 or tonumber(redis.call('GET', bytes) or '0') + #value > 33554432 then return -1 end
  local wrapped = cjson.encode({owner='', value=value})
  redis.call('HSET', jobs, id, wrapped)
  redis.call('INCRBY', bytes, #wrapped)
  redis.call('ZADD', due, now, id)
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
elseif op == 'dead' then
  redis.call('HSET', deadjobs, id, ARGV[5])
  redis.call('ZADD', dead, now, id)
  local old = redis.call('ZRANGE', dead, 0, -201)
  for _, k in ipairs(old) do redis.call('HDEL', deadjobs, k) redis.call('ZREM', dead, k) end
end
redis.call('HDEL', jobs, id)
redis.call('ZREM', due, id)
redis.call('INCRBY', bytes, -#raw)
return 1
