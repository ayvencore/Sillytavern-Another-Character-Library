# Another Character Library

A SillyTavern extension that replaces the default landing page with a rich character library view.

## Disclaimers

- This project is vibe coded.
- Mobile support is not working properly yet.

## Features

- Replaces the default empty-chat landing page with a full-screen character library.
- Searches across character names, SillyTavern built-in tags, Creator's Notes, creator name, version, first message, and personality/description text.
- Sorts by `A-Z`, `Z-A`, `Recently Added`, `Added First`, and `Recently Chatted`.
- Provides `All Characters` and `Favourite Characters` library tabs.
- Supports page-size controls for `12`, `24`, `48`, and `96`.
- Uses SillyTavern's built-in tag system for card display and edit-mode tag assignment.
- Shows card avatars, titles, Creator's Notes previews, built-in tag badges, a favourite star badge, and a card menu with `Favourite`, `Edit`, and `Delete`.
- Opens a detail modal with a larger image, first message, personality, built-in tags, creator link, quick chat, `Open in ST`, favourite, and delete actions.
- Includes an edit tab for Creator's Notes, creator name, version, creator link, first message, personality, and built-in tag assignment.
- Uses a separate favourites system from SillyTavern's built-in favourites, so you can keep an even smaller personal shortlist there.
- Adapts styling from SillyTavern theme variables.

## Images (Fresh ST install VS custom w/theme)

![image](https://i.imgur.com/dbNCoVY.png)
![image](https://i.imgur.com/5jp9HPw.png)
![image](https://i.imgur.com/RO8evI7.png)
![image](https://i.imgur.com/QBztr0k.png)
![image](https://i.imgur.com/aYSmWqw.png)
![image](https://i.imgur.com/Dk9Zy0I.png)

## Install

Install it through SillyTavern's built-in extension installer from the repository URL:

```text
https://github.com/ayvencore/Sillytavern-Another-Character-Library
```

## Notes

- Descriptions prefer `Creator's Notes` data from the character card.
- Personality maps to SillyTavern's native character `Description` field.
- The library reads tags from SillyTavern's built-in tag system, not from card-embedded tag fields.
- The library favourites are separate from SillyTavern's built-in favourites.
- Edit-mode saves are defensive: the extension updates local overrides and also attempts to call compatible SillyTavern save APIs.
- SillyTavern internals can vary by version, so the `Open in ST` bridge may still need small selector adjustments after live testing.
