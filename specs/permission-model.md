# Permission Model

* a group must have at least one member with role admin
* each member can have multiple roles
  * e.g. guardian, admin, and trainer
* depending on the role, different APIs are available
* depending on the role, more or less information shall be returned
* when creating a new group, the authenticated user must become the admin

## Admin

A member with role admin:

* has full access to a group
* he can assign trainers
* he can assign players
* he can managed events
* he can manage shirt sets
* he can invite players to events
* he can make selections for events
* he can create time periods
* ...

## Trainer

A trainer has fewer permissions but can do everything related to events:

* he can manage events
* he can manage players
* he can manage guardians
* he can invite players to events
* he can select players for teams
* he can change the invitation status of players
* he can view shirt sets
* he can assign shirts

## Assigned Trainer

A member of role admin, trainer, or guardian can be assigned to a
team as trainer. As an assigned trainer:

* he can see the details of the team such as location, time, ...
* he can see the assigned shirt numbers (if any)
* he can print the team card

## Guardian

Guardians can basically view what is relevant for their child and
change their invitation status:

* answer an invitation (accept / decline) in the name of the child
* see the events where his child is invited
* see the team where his child is selected

However, most of the information shall be hidden:

* level of the child
* list of members
* statistics
* shirt sets

## Player

Players do not have the possibility to login at the moment. If this
would be enabled later on, they would be able to do the same thing
as described by the "Guardian" role above.
