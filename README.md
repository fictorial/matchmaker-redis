A Node.js module that helps users create, find, and join "events" such as a
multiplayer game.  You may think of this as a matchmaking lobby backend.

## Concepts

- Events are created by users.
- Events have a required user count.
  - When this many users join the event, the event starts.
- Events have a whitelist and a blacklist of users.
  - If there's a whitelist, only users on the whitelist may join the event.
  - If there's a blacklist, any user on the blacklist may not join the event.
- No user may join an event after the event has started.
- A user may fetch events they are involved with
  - Created but pending events
  - Whitelisted but pending events
  - Joined but pending events
  - Joined and active/started events
- The creator of an event may cancel a pending event.
  - Active/started events may not be canceled.
- The system auto-cancels events that fail to start after some time.
  - The larger the user count, the more time the event has to start before auto-cancellation.
- A user may "autojoin" a compatible, pending event.
  - Compatible with a desired user count and event options.
- An event's options is encoded as a string and can contain anything.

## Runtime Dependencies

A running Redis instance.

## Installation

    npm i --save matchmaker-redis

## Usage

    const Redis = require('ioredis')
    const redis = new Redis(process.env.REDIS_URL)
    const matchmaker = require('matchmaker-redis')(redis)
    matchmaker.createEvent(...)

## API

An event looks like this:

    event = {
      id: string,
      userCount: int,
      options: string,
      userIds: [string],
      userAliases: [string],
      startedAt: int
    }

Create an event and wait for others to join it.

    createEvent({
      userId: string,
      userAlias: string,
      userCount: int,
      options: string,
      perUserTimeoutSec: int,
      whitelist: [string],
      blacklist: [string],
    }) -> Promise(event)

Find a pending event with the given options and user count and join it.

    autojoinEvent({
      userId: string,
      userAlias: string,
      userCount: int,
      options: string,
    }) -> Promise(event)

The creator may cancel an event before it auto-expires.

    cancelEvent(userId, eventId) -> Promise(true)

Get the pending and active events the user has created, joined,
or been whitelisted on.

    getEventsFor(userId) -> Promise({
      active: [event],
      pending: [event]
    })

Join a specific event. Usually in response to a user seeing that
they are on a whitelist.

    joinEvent(userId, userAlias, eventId) -> Promise(event)

## PUBSUB Side Effects

When a user joins an event, a JSON message is published to channel `events/${event.id}`.

    { "type": "join",
      "userId": string,
      "userAlias": string }

When an event is canceled, a message is published to channel `events/${event.id}`.

    { "type": "cancel" }

## Notes

Uses Redis for event coordination and storage but is not associated with any particular
transport (HTTP, WebSockets, etc).

## Running Tests

Note that the `TEST_DB_NO` (default: 1) database will be cleared/flushed.

    $ git clone ...

    $ npm i

    $ redis-server &

    $ REDIS_URL=redis://127.0.0.1:6379 \
      TEST_DB_NO=1 \
      DEBUG=tests npm test
