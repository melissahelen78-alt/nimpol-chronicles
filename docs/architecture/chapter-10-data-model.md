# Chapter 10 - Data Model

### Version 1.2

**Architecture Status**

This document defines the intended long-term conceptual data model for 
Nimpol Chronicles.

It is an architectural reference rather than an implementation checklist.

Individual features should implement only the smallest subset of this
model required for the current milestone while preserving the ownership
and relationship principles defined here.

# Purpose

The Data Model defines the major objects that make Nimpol Chronicles
real inside software.

Previous chapters describe the philosophy, world, memory, AI engines,
rules, parent support, wonder, system architecture, and persistence
architecture. This chapter turns those ideas into a concrete conceptual
model that can guide database design without locking the project into
one specific implementation too early.

The goal of this chapter is not to define every database column, index,
or policy. The goal is to define the entities, ownership boundaries,
relationships, and lifecycle rules that future tables should follow.

After this chapter, the database should be buildable one domain at a
time.

# Core Philosophy

The database is not a storage closet.

It is the structure that allows each Chronicle to remember, evolve, and
remain trustworthy.

AI may create stories, but the Data Model protects truth.

- Facts belong in structured data.
- Meaning belongs in storytelling.
- Ownership must be explicit.
- Relationships should be modeled, not implied.
- Player creativity must never be lost.
- Parents remain in control of all resources and activities offered.
- The system should be simple enough to build now and strong enough to
grow later.



# Architectural Principles



## 1. Family Is the Root of Ownership

A family is the ownership root for the accounts, players, resources,
settings, and Chronicles associated with that household. Version 1 may
only have one family in practice, but the model should behave as if
multiple families exist from the beginning.

## 2. Player Represents the Adventure Identity

The player is the person living the adventure. In Version 1, William is
the player and Nimpol is his hero identity inside Dragon Realm. The
database should use player as the durable concept because future
children, siblings, friends, or adults may also become players.

## 3. Chronicle Is the Private Canon Container

A Chronicle is a player’s lived version of a world. Version 1 may keep
Dragon Realm canon private to William’s Chronicle, but the model should
still leave room for shared base worlds later.

This means Dragon Realm can exist as a world, while William’s Dragon
Realm exists as a Chronicle-specific version of that world.

## 4. Resources and Activities Are Separate

A resource is something the parent has approved. An activity is a
specific use of that resource.

Example: Beast Academy Online is a *resource*. Complete one Beast
Academy lesson is an *activity*.

This separation allows the Quest Master to select from parent-approved
tools without inventing assignments.

## 5. Attributes Are Table-Driven

Attributes should not be hard-coded into application logic. They should
be defined as data so they can evolve over time.

Knowledge, Courage, Creativity, Empathy, Focus, Mana, or future
attributes should be created, configured, displayed, and balanced
through data rather than code changes.

## 6. AI Output Is Logged, Not Trusted as Truth

AI responses may be saved for debugging, review, and transparency.
However, raw AI output is never the source of truth.

Only validated structured outputs should update persistent state.

## 7. Design for Future Family and Multiplayer Without Building It Yet

The Version 1 product should remain single-player and simple. However,
the data model should avoid choices that would make future siblings,
trusted family members, or connected friends impossible without
redesign.

## 8. Entities Represent Concepts

Create a separate entity only when a concept has its own identity,
behavior, or configuration.

Otherwise, it is usually better represented as a field within another
entity.

*Entities represent concepts, not tables.*

Modeling concepts instead of implementation details creates a data model
that is easier to understand, extend, and maintain.

## 9. Identity, Role, and Relationship Are Separate Concepts

Every persistent character is described by three independent concepts:

- **Identity** defines who the character is.
- **Role** defines the purpose that character serves within the world.
- **Relationship** defines how that character is connected to a specific
player.

For example:

- **Nutty** is the character's identity.
- **Companion** is Nutty’s role within Dragon Realm.
- **Friend** is Nutty’s relationship with Nimpol.
- **High trust** is the current relationship state.

Each concept is owned independently:

- **Identity** belongs to the **Character**.
- **Role** belongs to the **World**.
- **Relationship** belongs to the **Player**.

Keeping these concepts independent allows characters to grow, change
roles, and build unique relationships with different players without
ever changing who they are.

# The Core Domain Model

The major domains work together to create a living Chronicle while
maintaining clear ownership and responsibilities.

***Family → Player → Chronicle***

Supporting these are the World and Adventure domains, which define the
setting and guide the player's current journey.

This model keeps the architecture simple and consistent.

- The Family owns the account, users, settings, and approved activities.
- The Player owns the hero's identity, growth, possessions, and
relationships.
- The World defines what can exist, including locations, characters,
attributes, skills, items, and the rules of the world.
- The Adventure tracks what is happening now by presenting quests,
choices, and objectives.
- The Chronicle preserves what mattered by recording discoveries,
meaningful scenes, relationship events, and the player's evolving
canon.

This philosophy can be summarized in a single principle:

> ***The Family owns the experience. The Player lives it. The World defines it.***  
> ***The Adventure advances it. The Chronicle remembers it.***



# Definition, State, Progression, and History

Most important concepts in Nimpol Chronicles can be understood through
four connected forms:

- Definition describes what can exist.
- State describes what is true right now.
- Progression describes how something can grow or change.
- History records how it became true.

These forms should remain separate even when they describe the same
concept.


| Concept   | Definition             | State                                   | Progression                            | History                                                   |
| --------- | ---------------------- | --------------------------------------- | -------------------------------------- | --------------------------------------------------------- |
| Location  | Mount Tippy Top exists | Currently discovered and accessible     | Access may unlock at a future rank     | Nimpol first reached it during the Mountain Quest         |
| Attribute | Knowledge exists       | Nimpol has Knowledge Level 2            | Knowledge Level 3 unlocks rune reading | Knowledge increased after completing Beast Academy Lesson |
| Character | Nutty exists           | Nutty is at the Treehouse and available | Nutty may grow braver over time        | Nutty became Nimpol’s companion                           |
| Item      | Glowing Acorn exists   | Nimpol owns one                         | It may be upgraded or gain new uses    | Nutty discovered it in a glowing tree                     |


Keeping these forms separate prevents current state from overwriting
definitions, allows progression rules to remain configurable, and
preserves history without turning the database into a log.

> ***Definitions establish possibility. State records the present.***  
> ***Progression guides growth. History preserves change.***



# Core Domains

A domain is a conceptual area of the system with a clear responsibility.
Domains are not required to map one-to-one with database schemas, but
they should guide how tables are grouped and understood.


| Domain           | Purpose                                    | Defines                                                                                |
| ---------------- | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| Identity         | Authentication and access management.      | Families, users, profiles, permissions, and system identity.                           |
| Player           | The hero’s persistent identity and growth. | Player state, attributes, skills, items, relationships and progression.                |
| Activities       | Parent-approved real-world experiences.    | Resources, activity definitions, routines, completions, and activity rules.            |
| World            | The structure and rules of a world.        | Locations, characters, species, attributes, skills, items, ranks, and world events.    |
| Adventure        | The player’s current story.                | Adventures, quests, objectives, choices, and story state.                              |
| Chronicle        | The player’s lasting story.                | Scenes, discoveries, canon, memories, and living history.                              |
| Wonder           | The player’s curiosity and exploration     | Wonder seeds, Wonder blooms, interests, and discoveries.                               |
| Parent Companion | Parent support and family guidance.        | Reflections, wellbeing, notes, explanations, and opportunities.                        |
| AI Operations    | AI transparency and system operations.     | AI requests, responses, structured outputs, validation, prompts, and operational logs. |




# Identity Domain

Defines Access

The Identity Domain stores who can access the system, how authenticated
users belong to a family, and how they are connected to players.

## Primary Entities


| Entity             | Purpose                                                                                                | Example                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| families           | Defines a household or account group.                                                                  | The Markwell family.                            |
| users              | Defines authenticated people who can log in.                                                           | Melissa and Eric can each have their own login. |
| user_profiles      | Stores app-facing identity and preferences for an authenticated user.                                  | Melissa, display name “Mom”                     |
| family_memberships | Connects authenticated users to a family and defines their family-level role and permissions.          | Melissa → Markwell family as Guardian and Admin |
| player_connections | Connects a user to a player and defines their real-world relationship and player-specific permissions. | Melissa → William as Mom with Guardian access   |




## Important Design Decision

**Users and players are separate identities.**

A user accesses and manages the system.

A player lives the adventure.

A player connection defines how an authenticated user is related to and
may interact with that player.

For example:

- Melissa is a user with Guardian permissions.
- William is a player whose hero identity is Nimpol.
- Melissa is connected to William as his mom.
- Within Dragon Realm, Mom may also be represented by an in-world
character such as Sorsha the Healer.

Keeping these concepts separate prevents authentication, real-world
family relationships, and story identities from becoming confused. It
also allows a player to exist without having a login and supports
multiple trusted users participating in that player’s Chronicle over
time.

# Player Domain

Defines Ownership and Progress

The Player Domain represents everything that belongs uniquely to a
player’s journey through a Chronicle.

Users access and manage the app. Players accumulate growth, possessions,
skills, relationships, and achievements.

The model supports multiple players within a family without changing the
architecture.

## Primary Entities


| Area          | Entity                    | Purpose                                                                                | Example                                                 |
| ------------- | ------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Identity      | players                   | Defines the person whose journey and Chronicle are being tracked.                      | William.                                                |
| Identity      | player_profiles           | Stores player-wide preferences that apply across Chronicles.                           | Accessibility preferences, general display preferences. |
| Identity      | chronicle_player_profiles | Stores the player’s identity and presentation within a specific Chronicle.             | Hero name Nimpol, wizard avatar, title Spellbinder.     |
| Growth        | player_attributes         | Stores a player’s current value for each world-defined attribute within a Chronicle.   | Nimpol has Knowledge Level 12.                          |
| Growth        | growth_events             | Records Chronicle-specific XP, attribute growth, unlocks, rewards, and milestones.     | +10 Knowledge from completing Beast Academy.            |
| Growth        | player_skills             | Stores world-defined skills the player has learned or improved within a Chronicle.     | Fireball, Ancient Translation.                          |
| Growth        | player_statistics         | Stores long-term derived or accumulated gameplay metrics within a Chronicle.           | Adventures completed, Wonders bloomed.                  |
| Growth        | player_unlocks            | Stores world content currently unlocked by the player.                                 | Ancient Translation unlocked.                           |
| Possessions   | player_items              | Stores items owned or discovered by the player within a Chronicle.                     | Nimpol owns one Glowing Acorn.                          |
| Relationships | relationships             | Defines the connection between a player and a persistent character within a Chronicle. | Nimpol and Nutty are Companions                         |
| Relationships | relationship_states       | Stores the current condition or strength of a relationship.                            | High trust, growing bond, active.                       |
| Status        | player_state              | Stores current Chronicle-specific player state that has no clearer owner.              | Selected companion.                                     |




## Player Progress

Player progress records belong to a player within a specific Chronicle.
Unless explicitly described as cross-Chronicle, Player Domain entities
should reference both player_id and chronicle_id.

## Player, World, and Chronicle Are Separate but Connected

The **World Domain** defines what is possible.

The **Player Domain** stores what belongs uniquely to the player.

The **Chronicle Domain** preserves the meaningful history created as the
player experiences that world.

Although these domains work together continuously, each has a distinct
responsibility.

For example:

- Nutty is a character defined in the **World Domain**.
- Nimpol's relationship with Nutty belongs to the **Player Domain**.
- The day Nutty became Nimpol's companion belongs to the **Chronicle
Domain**.

Likewise:

- Mount Tippy Top is a location defined in the **World Domain**.
- Whether Mount Tippy Top has currently been discovered belongs to the
Chronicle-specific world state within the **World Domain**.
- The first time Nimpol reached Mount Tippy Top belongs to the
**Chronicle Domain**.

Keeping these responsibilities separate allows the world to remain
consistent, the player to grow naturally, and the Chronicle to preserve
the story without duplicating or confusing data.

## Growth Should Be Explainable

Growth data should always be explainable to a parent. If Knowledge
increased, the system should be able to trace that increase to a
completed activity, reward decision, or meaningful story moment.

# Activities Domain

Defines Opportunity

The Activities Domain stores the real-world activities available to the
player, along with the parent-approved resources that support them.

It protects one of the core promises of Nimpol Chronicles:

- ***Parents build the toolbox. AI only selects from that toolbox.***

Not every activity is part of a quest.

Some activities are simply routines, family habits, chores, or
independent learning. The system quietly records these moments, rewards
meaningful growth, and allows the story to celebrate them naturally
without interrupting the adventure.

## Primary Entities


| Entity                     | Purpose                                                                                         | Example                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| resources                  | Stores parent-approved materials, tools, programs, and experiences that may support activities. | Beast Academy Online, workbook, video playlist.                     |
| resource_types             | Defines the behavior and configuration for different resource types.                            | Book, website, video, app, game, physical material, parent-created. |
| activity_definitions       | Defines specific real-world activities that can be completed.                                   | Complete one Beast Academy lesson. Brush teeth.                     |
| activity_categories        | Groups activities by purpose.                                                                   | Math, reading, science, movement, chore, hygiene.                   |
| activity_attribute_rewards | Defines which attributes an activity may support.                                               | Math puzzle increases Knowledge and Focus.                          |
| activity_resource_links    | Connects activities to one or more resources.                                                   | A math activity may use Beast Academy Online or workbook.           |
| activity_log               | Records completion of all real-world activities.                                                | Morning reading completed on July 9.                                |
| routines                   | Parent-defined recurring routines.                                                              | Morning Routine, Bedtime Routine.                                   |
| routine_steps              | Individual activities within a routine.                                                         | Brush teeth, get dressed, eat breakfast.                            |
| routine_sessions           | Tracks each execution of a routine.                                                             | Morning routine completed on July 9.                                |
| routine_rules              | Defines scheduling preferences and expectations.                                                | Weekdays only, weekends only, ask Monday.                           |




## Resources Are Not Assignments

The system should never confuse a resource with an activity. This keeps
curriculum flexible and prevents the AI from treating an entire book,
website, or program as a single assignment.

## Routines are Not Quests

Daily routines should feel lightweight.

Players should be able to complete everyday responsibilities without
constantly entering or leaving the story.

The system quietly records these accomplishments and allows the
adventure to acknowledge them naturally when appropriate.

A routine session groups one execution of a routine. Each completed
routine step creates or references an activity-log record linked to that
session.

## Initiative Matters

The Activities Domain records *how* an activity was completed—not to
judge the player, but to recognize growing independence.

Examples include:

- Completed independently
- Completed after a gentle reminder
- Completed with parent support

These observations may influence rewards, celebrations, and future
recommendations, but they should never be used to shame or punish the
player.

# World Domain

Defines Possibility

The World Domain defines what can exist within a world and stores
Chronicle-specific world state when that world is experienced by a
player.

It defines the places, inhabitants, environments, and events that make
the world feel alive. While Version 1 focuses on Dragon Realm, the model
is intentionally designed to support future worlds without requiring
structural changes.

## Primary Entities


| Entity                       | Purpose                                                                                                        | Example                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| worlds                       | Defines available worlds.                                                                                      | Dragon Realm.                                                         |
| world_state                  | Stores the Chronicle-specific current state of a world as a whole.                                             | Current season, active weather, world time.                           |
| regions                      | Defines large geographical areas within a world.                                                               | Northern Mountains, Great Serpent River Valley.                       |
| location_definitions         | Defines specific places that may be explored.                                                                  | Hidden Treehouse, Tree of Life and Death, Mount Tippy Top.            |
| location_states              | Stores the Chronicle-specific current state of a location.                                                     | Discovered, locked, damaged, decorated.                               |
| character_definitions        | Defines characters that exist in the world.                                                                    | Nutty, Mom, Ember, Village Blacksmith.                                |
| character_states             | Stores the Chronicle-specific current state of a character.                                                    | Current location, mood, availability, temporary condition.            |
| character_roles              | Defines in-world roles or archetypes.                                                                          | Companion, Guardian, Mentor, Merchant, Historian.                     |
| rank_levels                  | Defines world-specific rank titles, XP thresholds, and unlock meaning.                                         | Apprentice at 0 XP, Spellbinder at 250 XP.                            |
| attribute_definitions        | Defines attributes available in a world.                                                                       | Knowledge, Courage, Empathy, Creativity.                              |
| attribute_progression_levels | Defines thresholds, titles, unlocks, or meaning for each attribute level.                                      | Knowledge Level 5 unlocks simple rune reading.                        |
| species_definitions          | Defines the different kinds of living beings that exist within the world.                                      | Dragon, Human, Squirrel, Sea Serpent.                                 |
| creature_archetypes          | Defines reusable templates for unnamed or non-persistent creatures with their own behavior or encounter rules. | Forest Spider, Zombie, Wild Slime.                                    |
| skill_definitions            | Defines the skills, abilities, or powers that can exist within a world.                                        | Fireball, Ancient Translation, Dragon Speech.                         |
| item_definitions             | Defines items, artifacts, tools, recipes, rewards, or loot that may exist in a world.                          | Glowing Acorn, Healing Potion, Rune Key.                              |
| factions                     | Defines organizations, communities, or groups within the world.                                                | Dragon Council, Village Guards, Temple Keepers.                       |
| seasonal_event_definitions   | Defines recurring events that may occur within a world.                                                        | Harvest Festival, Winter Lantern Night.                               |
| world_events                 | Stores actual world-event occurrences within a Chronicle.                                                      | The Harvest Festival began on July 12; Disappearos Mountain returned. |




## World Definition and Chronicle State

The World Domain separates permanent definitions from their current
state within a Chronicle.

- Mount Tippy Top belongs in location_definitions.
- Its current accessibility or condition belongs in location_states.
- Ember is a character that belongs in character_definitions.
- Ember’s current location and availability belong in character_states.
- Dragon is a species that belongs in species_definitions.
- A specific encounter with a dragon belongs to Adventure or Chronicle
history.

This allows every Chronicle to evolve independently without altering the
shared foundation of the world. Chronicle-specific definitions may
extend that foundation while remaining private to the Chronicle that
created them.

## Shared and Chronicle-Specific Definitions

World definitions may come from the shared foundation of a world or be
created within a specific Chronicle. Dragon Realm may define Mount Tippy
Top for every Chronicle, while a location invented by William may belong
only in William’s Chronicle. Both are world definitions, but their scope
is different.

## Character Roles vs. Player Relationships

Character roles describe how a character functions within the world.
Relationships with specific players belong to the Player Domain.

# Adventure Domain

Defines the Present

The Adventure Domain stores what is currently happening in the story.

An Adventure is not the entire Chronicle. It is a current story chapter
with quests, objectives, choices, and outcomes.

## Primary Entities


| Entity                | Purpose                                                                                             | Example                                  |
| --------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| adventures            | Defines a current or completed adventure chapter.                                                   | The Temple Barrier Mystery.              |
| story_arcs            | Longer narrative threads.                                                                           | The mystery of the glowing sphere.       |
| quests                | Stores a quest within an adventure, including its goal, context, status, and completion conditions. | Find the glowing rune.                   |
| quest_objectives      | Breaks quests into smaller steps.                                                                   | Talk to Nutty, inspect the riverbank.    |
| quest_options         | Stores available player choices.                                                                    | Study runes, ask Mom, explore cave.      |
| quest_activity_links  | Connects quest options or quest needs to approved activities.                                       | Knowledge need → Beast Academy lesson.   |
| adventure_briefs      | Structured contracts passed to the Dungeon Master.                                                  | World update + priorities + constraints. |
| adventure_state       | Tracks current progress.                                                                            | Active, paused, completed.               |
| story_state_snapshots | Compact snapshots of current story state.                                                           | Useful for debugging and recovery.       |




## Quest Options Preserve Autonomy

The system should store choices rather than a single forced path
whenever possible. The player leads; the AI follows.

A quest may have several possible paths, and only some of those paths
may involve learning activities.

# Chronicle Domain

Defines Memory

The Chronicle Domain stores what mattered.

It is the living history of the player’s world. It does not store every
click, completed worksheet, or minor action. It stores meaningful
scenes, discoveries, relationship history, canon, and legendary moments.

## Primary Entities


| Entity                      | Purpose                                                                                 | Example                                                             |
| --------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| chronicles                  | Defines a player’s lived version of a world.                                            | William’s Dragon Realm.                                             |
| scenes                      | Stores meaningful story moments.                                                        | Opened the Temple.                                                  |
| scene_participants          | Records who actively participated.                                                      | Nimpol, Nutty, Ember.                                               |
| scene_witnesses             | Records who saw or learned about an event.                                              | Village Elder witnessed the return.                                 |
| participant_character_links | Connects a real-world participant to the character representing them within a Chronicle | Melissa as William’s mom → Sorsha the Healer                        |
| discoveries                 | Stores things learned or found.                                                         | Glowing sap reacts to moonlight.                                    |
| relationship_events         | History of relationship changes.                                                        | Nimpol and Nutty became trusted friends after the Temple Adventure. |
| canon_entries               | Stores confirmed truths.                                                                | Nimpol is the wizard’s name.                                        |
| dictionary_entries          | Stores invented and confirmed language.                                                 | Disappearos Mountain.                                               |
| chronicle_pages             | Stores polished storybook entries.                                                      | Chapter page for the Temple adventure.                              |




## Scenes Are Not Logs

A Scene should be created when something meaningfully changes: a
relationship deepens, a place is discovered, a mystery begins, a player
invents something, or a story arc reaches a milestone.

Routine activity completions belong in activity_log, not Chronicle
history.

# Wonder Domain

Defines Curiosity

The Wonder Domain stores curiosity.

Its purpose is to preserve questions and emerging interests without
turning them into assignments.

## Primary Entities


| Entity           | Purpose                                                   | Example                                        |
| ---------------- | --------------------------------------------------------- | ---------------------------------------------- |
| wonder_seeds     | Stores unanswered curiosities.                            | Why do blue plants help red plants grow?       |
| wonder_blooms    | Stores meaningful discoveries connected to a Wonder Seed. | Learned about plant cooperation.               |
| wonder_interests | Tracks gentle interest patterns.                          | Animals, maps, weather, machines.              |
| wonder_links     | Connections between Wonders and story elements.           | A Wonder linked to the Tree of Life and Death. |
| wonder_sources   | Records where a Wonder came from.                         | Story scene, player question, guardian note.   |
| scroll_entries   | Player-facing entries in the Scroll of Wonder.            | Saved questions, status, optional notes.       |




## Wonder Is Voluntary

Wonder data should never become a checklist. A Wonder Seed may bloom
today, later, or never. Its value comes from the player’s genuine
curiosity, not completion.

A Wonder bloom records the development of a curiosity and may reference
a Chronicle discovery when the discovery is historically meaningful.

# Parent Companion Domain

Defines Support

The Parent Companion Domain stores family preferences, planning,
parent-facing support, reflections, explanations, and wellbeing signals.

This domain exists to reduce cognitive load, not to judge the family.

## Primary Entities


| Entity                      | Purpose                                                                                   | Example                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| parent_reflections          | Stores parent-facing summaries.                                                           | William showed persistence today.                                                           |
| decision_explanations       | Explains why the system suggested something.                                              | Reading was overdue and tied to the Temple mystery.                                         |
| parent_notes                | Allows parents to record context.                                                         | Today needs to be lighter.                                                                  |
| wellbeing_checkins          | Stores optional parent check-ins.                                                         | Feeling overwhelmed, prefer lighter day.                                                    |
| family_opportunities        | Stores suggested shared moments.                                                          | Ask Dad about volcanoes this weekend.                                                       |
| family_schedule_preferences | Stores family rhythms, preferred activity days, availability, and scheduling preferences. | Experiential learning on Saturdays, Beast Academy weekdays, Dad teaches history on Tuesdays |




## No Judgment Data

Parent Companion data should be supportive and optional. It should never
be used to shame, score, diagnose, or pressure the family.

# AI Operations Domain

Defines Trust

The AI Operations Domain stores operational records for AI calls and
related engine workflows, including context, structured outputs,
validation, versioning, and debugging.

This domain supports transparency and maintainability while ensuring AI
output does not become the database’s source of truth.

## Primary Entities


| Entity             | Purpose                                                         | Example                                      |
| ------------------ | --------------------------------------------------------------- | -------------------------------------------- |
| ai_requests        | Stores inputs sent to AI engines.                               | Dungeon Master context packet.               |
| ai_responses       | Stores raw AI responses.                                        | Generated story scene.                       |
| prompt_versions    | Stores versioned prompt definitions used by generative engines. | Dungeon Master prompt v1.3                   |
| structured_outputs | Stores parsed and validated AI output.                          | Quest choices JSON.                          |
| validation_results | Stores whether output passed system checks.                     | Valid, rejected, needs review.               |
| engine_runs        | Tracks which engine ran and why.                                | Rules Engine, Dungeon Master, Reward Master. |
| engine_versions    | Tracks engine versions.                                         | Needed for debugging behavior changes.       |
| ai_cost_events     | Usage/cost tracking.                                            | Useful as the system scales.                 |




## Logs Support Trust

Logs are for debugging, accountability, and improvement. They should not
be treated as canon, state, or history unless converted into validated
structured records by the appropriate system.

# Relationship Patterns



## One Family Has Many Users

Mom and Dad may both log in. They belong to the same family but may have
different permissions.

## One Family Has Many Players

Version 1 focuses on a single player; however, the model supports
multiple players within the same family without changing the
architecture.

## One Player Has Many Chronicles Over Time

A player may eventually have multiple Chronicles: Dragon Realm, a future
science world, or a sibling-shared world.

## One Chronicle Has Many Scenes

Scenes are meaningful moments inside a Chronicle. They are the building
blocks of history.

## Many Characters May Participate in One Scene

A scene can include Nimpol, Nutty, Mom, a dragon, and a villager.
Participation should be explicit so future AI prompts know who
experienced what.

## One Character May Have Many Roles

A character may serve multiple roles within a world, such as Guardian
and Healer or Historian and Explorer. Roles are defined independently so
they can evolve without changing the character itself.

## One Player May Have Many Relationships

A player’s relationships with characters evolve independently of the
characters’ identities, roles, and world definitions.

## Many Activities May Support One Quest Need

Many activities may satisfy the same quest option or quest need. The
Quest Master selects from parent-approved activities, allowing the
player meaningful choice.

## One Definition May Be Experienced by Many Players

Shared world definitions may be experienced by many players, while
Chronicle-specific definitions remain private to the Chronicle that
created them. Each player experiences both through their own Chronicle.

# Common Entity Pattern

Most persistent entities should follow a common pattern unless there is
a reason not to.


| Field Concept | Purpose                                                      |
| ------------- | ------------------------------------------------------------ |
| id            | Stable unique identity.                                      |
| family_id     | Ownership root when applicable.                              |
| player_id     | Player ownership when applicable.                            |
| world_id      | World ownership or definition scope when applicable.         |
| chronicle_id  | Chronicle ownership when applicable.                         |
| created_at    | When the record was created.                                 |
| created_by    | Which user or system created it.                             |
| updated_at    | When the record last changed.                                |
| status        | Active, archived, completed, hidden, draft.                  |
| visibility    | Guardian-only, player-visible, system-only, future shared.   |
| source        | Guardian, player, AI, system, imported, family member.       |
| version       | Supports future changes and migrations.                      |
| metadata      | Flexible details that do not deserve first-class fields yet. |




## Metadata Warning

Metadata is useful, but it can become a junk drawer. If a metadata field
becomes important to rules, filtering, permissions, or AI retrieval, it
should probably become a real column or related entity.

# Entity Lifecycles


| Entity Type | Typical Lifecycle               | Delete Policy                                    |
| ----------- | ------------------------------- | ------------------------------------------------ |
| User        | Long-term                       | Deactivate rather than delete when possible.     |
| Player      | Long-term                       | Archive only with parent confirmation.           |
| Resource    | Long-term                       | Archive when no longer approved.                 |
| Activity    | Reusable                        | Archive rather than delete if history exists.    |
| Quest       | Short to medium                 | Complete, abandon, or archive.                   |
| Adventure   | Medium                          | Complete or archive.                             |
| Scene       | Permanent                       | Do not delete except by explicit family request. |
| Canon Entry | Permanent/versioned             | Version changes rather than overwrite.           |
| Wonder Seed | Open-ended                      | Bloom, rest, or archive.                         |
| AI Log      | Temporary or retained by policy | Expire according to privacy settings.            |




# Deletion Philosophy

Not all deletion means the same thing.

- Soft delete hides something from normal use.
- Archive preserves history while removing something from active
workflows.
- Versioning preserves old truth while allowing new truth.
- Hard delete removes data permanently and should be reserved for
privacy, legal, or explicit family requests.

Because Nimpol Chronicles stores player creativity, deletion should be
cautious, intentional, and transparent.

# Version 1 Scope



## Included in Version 1

- One family.
- Multiple guardian user logins.
- One player.
- Dragon Realm.
- One active Chronicle.
- Parent-approved resources.
- Activities and completions.
- Table-driven attributes.
- World locations and characters.
- Character roles and player relationships.
- Adventures and Quests.
- Chronicle scenes and canon dictionary.
- Wonder Seeds and Wonder Blooms.
- Parent support dashboard.
- Family scheduling preferences.
- AI request and response logs.



## Intentionally Not Built in Version 1

- Connected friend adventures.
- Shared sibling worlds.
- Marketplace or public world sharing.
- Calendar integration.
- Advanced analytics dashboards.
- Community events.
- Marketplace content.
- Cross-family multiplayer.

The model should leave room for these features without building them
prematurely.

# Future Growth

The Data Model should support future domains without requiring the
foundation to be rebuilt.

- Family participation.
- Sibling Chronicles.
- Trusted friend adventures.
- Shared family events.
- Crafting systems.
- Advanced pets and companion systems.
- Creative portfolios.
- Analytics and insights.
- Community worlds.
- Additional flagship worlds.

Future features should plug into the ownership chain rather than bypass
it.

# Risks and Guardrails



## Risk: Overbuilding Too Early

A future-ready model can easily become too complex. Version 1 should
only build what is needed, while using names and ownership patterns that
will survive future expansion.

## Risk: Metadata Creep

Too much flexible metadata can hide important structure. Important
concepts should become real entities.

## Risk: AI Becoming the Database

AI output should never be treated as truth without validation. The
database stores facts. AI creates meaning.

## Risk: Turning the Chronicle Into a Log

The Chronicle should preserve meaningful history, not every action.
Exhaustive logging belongs elsewhere.

## Risk: Mixing Identity, Role, and Relationship

A character’s identity, purpose, and relationship to a player should
remain separate. Mixing them creates special cases and makes future
character growth harder.

# Manual Table-Building Strategy

For Version 1, manually building tables in Supabase is a reasonable
choice because it forces close review of the model. The goal is not
speed. The goal is understanding.

Manual table creation should still follow a written plan so the database
does not become inconsistent.

# Implementation Note

The conceptual model defined in this chapter intentionally remains
independent of implementation order. A separate Database Implementation
Guide describes the recommended table creation sequence, database
conventions, migration strategy, and implementation checklist for
Version 1.

# Final Principle

A good data model should disappear.

Developers should think in meaningful objects rather than tangled
tables.

AI should receive structured truth rather than guess at history.

Families should trust that the system remembers accurately.

Players should simply feel that their world is alive.

# The Promise of the Data Model

The Data Model exists so that Nimpol Chronicles can grow without losing
itself.

It protects the player’s creations, the family’s decisions, the world’s
continuity, and the system’s long-term maintainability.

If the model is strong, the app can change.

The interface can change.

The AI prompts can change.

The worlds can multiply.

But the foundation remains understandable.

That is what allows a single player’s Dragon Realm to become the
beginning of something much larger without losing the wonder that
started it.

# The Nine Foundations

Every part of Nimpol Chronicles exists to fulfill one of these
responsibilities.

- **Identity** defines access.
- **Player** defines ownership and progress.
- **Activities** define opportunity.
- **World** defines possibility.
- **Adventure** defines the present.
- **Chronicle** defines memory.
- **Wonder** defines curiosity.
- **Parent Companion** defines support.
- **AI Operations** define trust.

Together, these foundations ensure that every feature has a clear
purpose, every piece of data has a home, and every system has a defined
responsibility.