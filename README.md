nodeJS + set
============

This is a multiplayer, realtime implementation of the popular ["Set" card game][1].
It uses [socket.io][2] to achieve realtime feedback with clients and [jQuery][3] for
various clientside animations.

The server runs in dev mode with:

    ./start

npm dependencies are

    connect
    connect-gzip
    connect-no-www
    socket.io
    ams

[1]: http://en.wikipedia.org/wiki/Set_(game)
[2]: http://socket.io/
[3]: https://github.com/jquery/jquery
