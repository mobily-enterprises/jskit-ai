# `repositories/`

Use this directory for low-level repository helpers shared by more than one repository file.

What belongs here:
- repository helpers that are part of persistence logic

Examples:
- SQL/date/JSON helper functions reused by several repositories

Do not put these here:
- full repositories owned by one domain or feature
- business logic
- action definitions
- transport validation
- feature-specific response mapping

Rule:
- if a helper is reused by multiple repository files, it can live here
- if it is a real repository for one domain, keep it in that domain folder
