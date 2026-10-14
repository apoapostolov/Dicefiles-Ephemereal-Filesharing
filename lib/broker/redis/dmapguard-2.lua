if (redis.call('HGET', KEYS[2], ARGV[4]) or '') ~= ARGV[5] then return -1 end
if redis.call('HGET', KEYS[1], ARGV[1]) ~= ARGV[2] then return 0 end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
redis.call('PUBLISH', KEYS[1], cjson.encode({{pid='atomic', t='s', k=cjson.decode(ARGV[1]), v=cjson.decode(ARGV[3])}}))
return 1
