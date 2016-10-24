module.exports = function (redis) {

  redis.defineCommand('createEvent', {
    numberOfKeys: 2,
    lua: `
      local eventKey = KEYS[1]
      local pendingKey = KEYS[2]

      local eventJSON = ARGV[1]
      local event = cjson.decode(eventJSON)

      redis.call('set', eventKey, eventJSON)
      redis.call('sadd', pendingKey, eventKey)
    `
  })

  redis.defineCommand('autojoinEvent', {
    numberOfKeys: 2,
    lua: `
      local pendingKey = KEYS[1]
      local activeKey = KEYS[2]

      local userId = ARGV[1]
      local userAlias = ARGV[2]
      local capacity = tonumber(ARGV[3])
      local params = ARGV[4]
      local timestamp = tonumber(ARGV[5])

      local eventKeys = redis.call('smembers', pendingKey)

      if eventKeys == false then
        return nil
      end

      for i, eventKey in ipairs(eventKeys) do
        local eventJSON = redis.call('get', eventKey)

        if eventJSON == false then
          redis.call('srem', pendingKey, eventKey)
        else
          local event = cjson.decode(eventJSON)

          if event.capacity == capacity and
             event.params == params then

            local hasJoined = false
            local usersJoinedCount = 0
            for _, v in pairs(event.userIds) do
              usersJoinedCount = usersJoinedCount + 1
              if userId == v then
                hasJoined = true -- no break; get user count
              end
            end

            if not hasJoined then
              local canJoin = false

              local whitelistCount = 0
              local onWhitelist = false
              for _, v in pairs(event.whitelist) do
                whitelistCount = whitelistCount + 1
                if v == userId then
                  onWhitelist = true
                  break
                end
              end

              if onWhitelist then
                canJoin = true
              else
                local onBlacklist = false
                for _, v in pairs(event.blacklist) do
                  if v == userId then
                    onBlacklist = true
                    break
                  end
                end
                canJoin = (not onBlacklist)
              end

              if canJoin then
                table.insert(event.userIds, userId)
                table.insert(event.aliases, userAlias)

                if usersJoinedCount + 1 == event.capacity then
                  redis.call('srem', pendingKey, eventKey)
                  redis.call('sadd', activeKey, eventKey)
                  event.startedAt = timestamp
                end

                eventJSON = cjson.encode(event)
                redis.call('set', eventKey, eventJSON)

                local msg = { type='join', userId=userId, userAlias=userAlias }
                redis.call('publish', 'events/' .. event.id, cjson.encode(msg))

                return eventJSON
              end
            end
          end
        end
      end

      return nil
    `
  })

  redis.defineCommand('cancelEvent', {
    numberOfKeys: 2,
    lua: `
      local eventKey = KEYS[1]
      local pendingKey = KEYS[2]

      local userId = ARGV[1]

      local eventJSON = redis.call('get', eventKey)
      if eventJSON == false then
        return redis.error_reply('not found')
      end

      local event = cjson.decode(eventJSON)
      if event.userIds[1] ~= userId then
        return redis.error_reply('forbidden')
      end
      if event.startedAt then
        return redis.error_reply('already started')
      end

      redis.call('srem', pendingKey, eventKey)
      redis.call('del', eventKey)

      local msg = { type='cancel' }
      redis.call('publish', 'events/' .. event.id, cjson.encode(msg))
    `
  })

  redis.defineCommand('getPendingEventsFor', {
    numberOfKeys: 1,
    lua: `
      local pendingKey = KEYS[1]
      local userId = ARGV[1]

      local eventKeys = redis.call('smembers', pendingKey)
      local events = {}

      if eventKeys == false then
        return '[]'
      end

      for i, eventKey in ipairs(eventKeys) do
        local eventJSON = redis.call('get', eventKey)

        if eventJSON == false then
          redis.call('srem', pendingKey, eventKey)
        else
          local event = cjson.decode(eventJSON)

          local hasJoined = false
          local usersJoinedCount = 0
          for _, v in pairs(event.userIds) do
            usersJoinedCount = usersJoinedCount + 1
            if userId == v then
              hasJoined = true -- no break; get user count
            end
          end

          local onWhitelist = false

          if not hasJoined then
            for _, v in pairs(event.whitelist) do
              if v == userId then
                onWhitelist = true
                break
              end
            end
          end

          if hasJoined or onWhitelist then
            table.insert(events, event)
          end
        end
      end

      return cjson.encode(events)
    `
  })

  redis.defineCommand('getActiveEventsFor', {
    numberOfKeys: 1,
    lua: `
      local activeKey = KEYS[1]
      local userId = ARGV[1]

      local eventKeys = redis.call('smembers', activeKey)
      local events = {}

      if eventKeys == false then
        return '[]'
      end

      for i, eventKey in ipairs(eventKeys) do
        local eventJSON = redis.call('get', eventKey)
        local event = cjson.decode(eventJSON)

        for _, v in pairs(event.userIds) do
          if userId == v then
            table.insert(events, event)
            break
          end
        end
      end

      return cjson.encode(events)
    `
  })

  redis.defineCommand('joinEvent', {
    numberOfKeys: 3,
    lua: `
      local eventKey = KEYS[1]
      local pendingKey = KEYS[2]
      local activeKey = KEYS[3]

      local userId = ARGV[1]
      local userAlias = ARGV[2]
      local timestamp = tonumber(ARGV[3])

      local eventJSON = redis.call('get', eventKey)

      if eventJSON == false then
        redis.call('srem', pendingKey, eventKey)
        return redis.error_reply('not found')
      end

      local event = cjson.decode(eventJSON)

      if event.startedAt then
        return redis.error_reply('already started')
      end

      local hasJoined = false
      local usersJoinedCount = 0
      for _, v in pairs(event.userIds) do
        usersJoinedCount = usersJoinedCount + 1
        if userId == v then
          hasJoined = true -- no break; get user count
        end
      end

      if hasJoined then
        return redis.error_reply('already joined')
      end

      local onWhitelist = false
      for _, v in pairs(event.whitelist) do
        if v == userId then
          onWhitelist = true
          break
        end
      end

      if not onWhitelist then
        return redis.error_reply('forbidden')
      end

      table.insert(event.userIds, userId)
      table.insert(event.aliases, userAlias)

      if usersJoinedCount + 1 == event.capacity then
        redis.call('srem', pendingKey, eventKey)
        redis.call('sadd', activeKey, eventKey)
        event.startedAt = timestamp
      end

      eventJSON = cjson.encode(event)
      redis.call('set', eventKey, eventJSON)

      local msg = { type='join', userId=userId, userAlias=userAlias }
      redis.call('publish', 'events/' .. event.id, cjson.encode(msg))

      return eventJSON
    `
  })
}
