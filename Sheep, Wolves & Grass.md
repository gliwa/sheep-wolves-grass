# SWG: Sheep, Wolves & Grass
Sheep, Wolves & Grass is a computer game for one to 10 players. It is played in a
browser und uses simplistic ASCII graphics. The screen shows the complete play field,
no zooming, no scrolling.

## Story line
The background story goes like this: a meadow is home to some
sheep which graze. There are also woulves which, of course, feed on the sheep. Each player
controls one sheep and one wolf using the computer keyboard. The sheep can be moved around
using the cursor keys, the wolf using Shift + cursor keys. Consequently, the user can only
move one of them at a time. The sheep and the wolves are represented by letters, by single
ASCII characters: wolves by upper case letters and sheep by lower case letters. Player A
controls wolf 'A' and sheep 'a', player B controls wolf 'B' and sheep 'b' and so forth.
The figures of each player additionally are shown in individual colors. Blue for player A,
red for player B, etc.

The grass is represented by commas, by ASCII character ','. The grass is randomly spread
across the screen. It keeps growing meaning that, over time, more and more commas are added.
If a sheep is moved to the position of a grass character, the comma (the grass) vanishes from the
screen and the corresponding player gets a point. These points obviously accumulate and
are displayed at the top of the screen. The figure below shows the game with three players.

```
Peter(A):23  Paul(B):18  Mary(C):22
╔════════════════════════════════════════════════════════════════════════╗
║                   ,                                                    ║
║                                           ,                            ║
║                                                                        ║
║        A                    ,                        ,     c           ║
║                                      C                                 ║
║                ,                  a                        ,           ║
║                                                                        ║
║      ,          ,                                                      ║
║                           B                  ,               ,         ║
║                  ,                                                     ║
║                                                     ,                  ║
║                                                                        ║
║                     ,                               ,                  ║
║                              ,                            ,            ║
║              ,                                                         ║
║                                                    b                   ║
║   ,                            ,            ,                          ║
║          ,                                                    ,        ║
║                ,   ,                                                   ║
║                                            ,           ,               ║
╚════════════════════════════════════════════════════════════════════════╝
```
Figure 1: Play screen

If a wolf is moved to the position of a sheep, the sheep is 'eaten' by the wolf and the player
associated to the sheep is out of the round. The player related to the wolf eating the sheep
receives ten points. 
The wolf of the player who just lost the sheep remains in the game but
cannot be controlled anymore. However, if another player is careless enough to navigate her or his
sheep to the position of such a lonely wolf, the wolf 'eats' the sheep and the wolf's player gains
ten points.

A player's wolf can only eat sheep of other players, not the player's own sheep.

Once the last sheep has been eaten, the round ends and the player with the highest score wins
the round.

## Game start, users joining
The game comes with three screen modes: the start screen, the play screen and the hold screen.
A user joins a game by navigating to the URL of the game server. The user will see the start
screen which lists all users who joined so far. The server assignes 'Player A' to the first
user, 'Player B' to the second user and so forth.
```
╔════════════════════════════════════════════════════════════════════════╗
║                      Sheep, Wolves & Grass                             ║
║                                                                        ║
║                     Your are Player B (Paul).                          ║
║                                                                        ║
║ Press [Enter] to edit name, 'P' to play, 'B' to add a bot, 'E' to exit ║
║                                                                        ║
║  Position Player Name          Rounds Score Status                     ║
║  --------------------------------------------------------------------- ║
║  1st      C      Mary          3         98 waiting for others to join ║
║  2nd      B      Paul          3         81 waiting for others to join ║
║  3rd      A      Peter         3         79 ready to play              ║
║                                                                        ║
║                        auto start in 28s                               ║
║                                                                        ║
║                                                                        ║
║                                                                        ║
║                                                                        ║
║                                                                        ║
║                                                                        ║
║                                                                        ║
╚════════════════════════════════════════════════════════════════════════╝
```
Figure 2: Start screen

The initial state of each player is 'waiting for others to join' and the default
name of each player is 'Player <N>', e.g. 'Player A'. While in this 'waiting for others
to join'state, users can hit the Enter key to edit their name. They will see the characters
they enter in the text line below the Title. When done, they hit Enter again to confirm and
the name gets copied to the table. Alternatively, a user can hit ESC while entering the name
to restore the name before they hit Enter.

While in state 'waiting for others to join', any player can hit 'B' to add a bot. A bot is a
player played by the computer. The name is auto generated: Bot1 for the first bot, Bot2 for
the second and so forth. A maximum number of 10 players is supported and this includes the
human users as well as the bots.

Users can then press 'P' to switch their player's state to 'ready to play'.
Once all players who joined switched to this state, the round starts and the GUI displays the
play screen.

There is a one minute timeout for waiting for others to join. If this elapses, all players
are automatically put into state 'ready to play'. If there was only a single player on the
start screen, a bot is added automatically.

Users can exit the game by pressing 'E'. Their player's state will be set to 'left the game'.
Once in that state, they will no longer be part of a round. Their stats remain on the start
screen though. 

## Game Round
### Initial play screen
The initial play screen comes with initial 20 grass characters (ASCII character ',') spread
across the screen. The sheep and wolves of each player are placed on the screen as a pair
meaning next to each other: the wolf on one position and the sheep on the position right
to the wolf. The pairs of each player are placed on the screen in a way that the distances
between the pairs are maximaized. With two players this means that one player A's pair is
placed in the top left cornder and the pair of player B in the bottom right corner. With
four players, the pairs are placed in the four corners and so on.

Once all pairs and all grass characters are placed, the round begins. All the placinf will
happen so quickly, that users experience an immediate game start.

### Playing
Users now move their sheep and wolves around as described above. They need to decide whether
they collect points through eating grass with their sheep or whether they go after to other
player' sheep. The game is set up in a way that these two strategies are nicely balanced
meaning that both are equally good.

### End of the round
Once the last sheep has been eaten, the round ends and the game switches back to the start
screen indicating the rounds a player has played so far and how many points each player
accumulated. All bots are set to state to 'ready to play', all players played by users are
set to state 'waiting for others to join'.

### End of the game
The game ends when all users decided to exit the game.

## Game variation: chess mode
Chess mode is a variant of the game with one single but very relevant modification.
In chess mode, the input from all users is awaited before the play field is updated.
This transforms the game from a hectic 'dash & hunt' game into a chess-like strategic
'take your time and think' game.

The start screen gets extended: users can now vote to switch to chess mode by pressing 'C'.
The table on the start screen gets extended by another column "Chess" and each player
who voted for chess mode gets an sterix '*' in the Chess column.
When the round starts and all players voted for chess mode, the round will start in chess
mode.

## Requirements for development
The following requirements extend the general description above, which also serve as
requirements for the design and implementation for the game.

* The actual game control will be executed as some sort of web service on a server.
* The play experience will be closely related to the reaction time users experience.
  Any significant lag would spoil the fun. So, the time taken by a 'round trip'
  <keyboard input -> data sent to server -> server calculates new situation -> data
  sent to clients -> new situation becomes visual on the users' screens> should not
  take too long. Below 50ms would be great, 100ms might still be acceptable.
* The time taken for a round trip depends on the connection quality between
  a user's client and the server. This can vary between users. It might make sense
  to introduce some time quantization, some sort of simulation tick. The game situation
  would not get updated each time an event (a user's keybord hit) is received by the
  server but every x milliseconds. All input commands collected between two ticks would
  then be handled in one go. This would, to some extent, mitigate different connection
  qualities of different users.
* The game naturally comes with a play API which allows the client to inform the server
  about keybord input from a user and which allows the server to send situation data
  (position of sheep, wolves and grass as well as points, player names, etc.) to the
  clients.
* Game parameters are constant values which influence the game. In order to maximize
  the fun factor of the game, these game parameters must be configurable for developers,
  maybe even for advanced users.
* Game parameters should be configurable through a web API.
* The following game parameters should be configurable. Each parameter is indicated by its
  name. Parameter names start with cfg (short for configuration).
  * `cfgFieldSizeX`, unsigned int, default=50: Horizontal size of the game field in characters
  * `cfgFieldSizeY`, unsigned int, default=30: Vertical size of the game field in characters
  * `cfgMayNofPlayers`, unsigned int, default=10: Maximum number of players
  * `cfgColors`, JSON string, default to be defined: Colors used for players
  * `cfgSheepKillBonus`, unsigned int, default=10: Points a player gets for eating a sheep
  * `cfgInitialNofGrass`, unsigned int, default=20: initial number of commas at the start of a round
  * `cfgGrassGrowRate`, unsigned int, default=20: grass grow rate in commas per minute
  * `cfgMaxNofGrass`, unsigned int, default=40: maximum number of commas on the screen (once this value is reached,
    no more grass grows)
  * `cfgStartTimeout`, unsigned int, default=60: timeout value in seconds
  * `cfgChessVoteThreshold`, unsigned int, default=100: value between 0 and 100 in %.
    If the share of users who voted for chess mode is greater than or equal
    `cfgChessVoteThreshold`, the next round will run in chess mode.
* The play API allows computers to pretent they are humans, which nicely supports automated
  tests.
* The web API for the parameters allows computers to try out different settings.
* An LLM shall be used to instantiate a number of players which play the game and through
  the web API for the parameters, the LLM could find the best parameters for a well balanced
  game according to the two different strategies mentioned earlier. Let's call this
  'game optimization'.
* During game optimization, it might make sense to disable the time quantization to allow
  very fast optimization without having to wait for simulation ticks to expire.