# VVE Domain

VVE is an internal collaborative board for a tutoring company. It gives administrators, teachers, and students access through revocable long-lived links instead of user accounts.

## People and identity

**Administrator**:
A trusted employee who manages teachers and their access to VVE.
_Avoid_: Manager, admin user

**Teacher**:
A tutor who manages durable boards for individual students or student groups.
_Avoid_: Tutor, instructor, user

**Owning Teacher**:
The single Teacher responsible for a Managed Board. Ownership cannot be shared or delegated to another Teacher.
_Avoid_: Board admin, primary teacher, co-teacher

**Student**:
A learner who receives access to a Managed Board. A Student may participate individually or as a member of a group sharing one board.
_Avoid_: Client, learner user

**Student Label**:
A minimal Teacher-facing label used to distinguish a Student or student group. An individual normally uses a first name and the shortest unambiguous surname prefix, while a group lists the Students' first names separated by commas.
_Avoid_: Student name, full name, account name

**Collaborator Label**:
An ephemeral system-assigned label and color used to distinguish simultaneous Student cursors during a lesson, such as `Student 1` or `Student 2`. It is not a verified identity, need not match a Student Label, and cannot be changed by the Student.
_Avoid_: Student identity, account name, participant account

**Public Teacher Identity**:
The exact shared alias `Dawid Furmaniuk - Matsin`, shown to every Student instead of a Teacher's real identity. Every Teacher appears under this same immutable identity in Student-facing surfaces.
_Avoid_: Teacher name, display name

## Access

**Teacher Access Link**:
A revocable capability that grants a Teacher access to their dashboard and boards on any device where the link is opened. It does not expire automatically during the Pilot; a Teacher has exactly one active link, and explicit regeneration immediately invalidates the previous link without affecting boards.
_Avoid_: Permalink, login link, teacher token

**Board Access Link**:
A revocable capability that grants one Student or a student group access to one Managed Board on any device where the link is opened. A Managed Board has exactly one active Board Access Link, which remains valid for twelve months during the Pilot.
_Avoid_: Student permalink, invitation URL

**Revocation**:
The immediate invalidation of an access link. Revocation of board access or deactivation of a Teacher starts a seven-day Deletion Grace Period, while regeneration only replaces a credential and preserves data.

**Deletion Grace Period**:
The seven days between loss of access and permanent deletion of the affected board data. The Pilot does not expose recovery controls during this period.

## Boards

**Managed Board**:
A durable collaborative workspace with exactly one Owning Teacher and one or more Students. Students may access and edit it without the Owning Teacher being present, and it retains lesson and homework content across months.
_Avoid_: Student board, room, branch

**Personal Board**:
A durable workspace created on the Teacher's first dashboard visit. It is available for private preparation and product testing, and it never grants Student access.
_Avoid_: Quick board, scratch room

**Student Work**:
Lesson notes, homework, and other learning material created on a Managed Board and treated as the Student's material.

**Lesson Session**:
A live collaboration period in which one Owning Teacher and up to three Students work on the same Managed Board during the Pilot, normally for two or three hours. Group lessons are expected to be rare. Uninterrupted entry and collaboration during a Lesson Session are the Pilot's highest reliability requirement.

## Delivery stages

**Pilot**:
A controlled real-world deployment with no more than 20 selected Teachers and their real Students. Lesson Sessions and access-link flows must be reliable, but the Pilot does not promise recovery from complete system loss. AI functionality is unavailable during the Pilot.

**Company Rollout**:
The stage triggered after the 20-Teacher Pilot has produced cost and load measurements. VVE then targets hundreds of Teachers, with an upper planning order of about one thousand Teachers and between two thousand and ten thousand Students.
