# Meta VR Start Developer Competition 2026

> Meta's Devpost contest for Meta VR Start program members: build a hands-first VR/MR experience for Meta VR devices (Meta Quest and Meta VR Glasses) in the Entertainment, Gaming or Productivity track, and compete for up to $1,000,000 USD in 20 cash prizes. Entries close November 18, 2026 at 12:00 PM PT (Thursday November 19, 2026, 7:00 AM AEDT, Sydney).

This file summarizes the official competition page and Official Rules for coding agents. The Official Rules are the binding contract; if anything here disagrees with them, the rules win. Captured November 12, 2026.

## Official pages

- [Competition overview (Devpost)](https://start-developer-competition-26.devpost.com/): what to build, what to submit, prizes
- [Official Rules (Devpost)](https://start-developer-competition-26.devpost.com/rules): eligibility, entry requirements, judging criteria, prize terms
- [Meta announcement (community forum)](https://communityforums.atmeta.com/news-announcements-24/meta-vr-start-developer-competition-2026-180286)
- [Meta developer blog announcement](https://developers.meta.com/blog/meta-connect-2026-vr-start-developer-competition/)
- [Support thread for questions](https://communityforums.atmeta.com/discussions/start-events-and-competitions/meta-vr-start-developer-competition-2026/1384075)
- [Live programming for Start members](https://communityforums.atmeta.com/category/horizon-developer-forum/events/start_events)
- [Meta VR Start program](https://developers.meta.com/vr/discover/programs/start/) and [Start application form](https://developers.meta.com/vr/programs/start/apply/)

## Key dates

| Event | Date |
|---|---|
| Entry period opens | September 24, 2026, 10:00 AM PT |
| Entry period closes (submission deadline) | November 18, 2026, 12:00 PM PT = Thu Nov 19, 2026, 7:00 AM AEDT (Sydney) |
| Judging period | On or around November 18 to December 9, 2026 |
| Winners announced | On or around December 11, 2026 |

- No changes to a submission after the entry period ends. Judging uses the state of the entry at the deadline.
- The project must stay available and accessible until the winner announcement (about December 11, 2026).
- 5,870 participants were registered on Devpost as of November 12, 2026.

## Eligibility (Official Rules, section 2)

As of the start of the entry period, every entrant (individual, or each member of a Team or Organization) must:

- Be at least 18 and the age of majority where they live.
- Not live in, or be an organization based in, Brazil, Quebec, or any area under comprehensive sanctions (e.g. Crimea, Russia, Cuba, Iran, North Korea, Syria, or anyone designated by the US Treasury OFAC), including countries with banking or wire-transfer restrictions.
- Have an active, valid Meta account with Developer Access enabled by the time of submission.
- The person submitting (the Representative) must be a member of the Meta VR Start program by the time of submission.

Entry rules:

- Enter as an individual, a Team (2+ eligible people), or an Organization (legal entity; politically affiliated organizations are not eligible).
- Teams and Organizations appoint one Representative, who submits the entry and receives any prize.
- Each individual may submit only one entry. You may be a solo entrant and also a non-Representative member of other teams, but you may not be both a solo entrant and a Team Representative, and you may represent only one Team or Organization.
- Meta employees, contest partners, their families and households, and government or political officials are not eligible.

## What to build

An experience built for Meta VR devices, aligned to at least one of three tracks. Top awards go to the strongest entries in each track; special awards recognize standout craft across all of them. The Sponsor may reassign an entry to a different track or division.

### Tracks

- **Entertainment**: Lean-back media and content experiences: spatial cinema, interactive video, music visualization, immersive storytelling, spatial audio, media companion apps (e.g. commentary tracks, popup production notes, social comments). Content designed to be consumed in any environment. Hands-first implementation required.
- **Gaming**: Games designed for hands-first (required) or eyes and hands. Puzzle, strategy, casual, social, narrative: genres that thrive seated, without controllers.
- **Productivity**: Apps that make you more effective anywhere or are designed around specific daily moments: multi-panel workspaces, task management, creative tools, or habits tied to a recurring context (morning routine, commute, wind-down). Hands-first implementation required.

### Divisions

- **New Experience**: Start from a blank slate. The project is conceived of and built within the competition window, beginning September 24, 2026. No pre-existing codebases, no shipped titles, no early access builds repurposed.
- **Adapted / Significantly Updated Experience**: A pre-existing project (any build, prototype, or published app that existed before September 24, 2026) with a meaningful new feature, mode, or platform integration shipped during the competition window. The Sponsor decides whether an update is significant.
  - Significant update examples: implementing hand interactions as a new feature; adding multiplayer support; introducing a mixed reality (MR) interaction mode as a new feature; releasing a new user-generated content creation tool.
  - Not significant: bug fixes or minor UI tweaks; cosmetic changes such as a new color scheme; performance optimization without new user-facing features.

## Hard requirements

- **Hands-first**: Your experience must be fully usable with hands, end-to-end. Controller support is welcome, but not required. The test is simple: can someone complete the entire experience without ever pairing a controller?
- **Policy compliance**: Your experience must adhere to all relevant Meta VR/Start policies and terms:
  - [Meta VR Start Program Terms](https://developers.meta.com/horizon/start/terms/)
  - [Community Standards](https://transparency.fb.com/policies/community-standards/)
  - [Code of Conduct in VR Policy](https://support.oculus.com/articles/accounts/privacy-information-and-settings/conduct-in-vr-policy)
  - [Developer App Policies](https://developers.meta.com/horizon/policy/#app-policies)
  - [Developer Content Guidelines](https://developers.meta.com/horizon/policy/#content-guidelines)
  - All other [Developer Policies](https://developers.meta.com/horizon/policy/)

## Design guidelines

- **Seated-optimized**: Design for seated, stationary use. Limit roomscale, no large physical movement. Apply the airplane seat test: does every interaction work in a two-foot radius?
- **Easy to get into and out of**: Fast cold start, clean pause/resume, and something satisfying in 10 minutes or less. Apply the one bus stop test: can someone have a complete moment in a short ride?
- **Original, not a wrapper**: Core experience is Entrant-built. Thin wrappers around existing platforms or services (YouTube, ChatGPT, etc.) are highly discouraged. Apply the take it away test: if you remove the third-party service, is there still a Project?

## Suggested SDKs

- **Unity**: Meta XR SDKs [v81+](https://developers.meta.com/horizon/downloads/package/meta-xr-sdk-all-in-one-upm/81.0) (v207) All-in-One XR
- **Unreal**: Unreal Engine 5.8 and Oculus Integration SDK v207+
- **Android apps**: React Native via [Expo](https://reactnative.dev/blog/2026/02/24/react-native-comes-to-meta-quest), or Jetpack Compose via [Meta VR Plugin for Android Studio](https://developers.meta.com/horizon/documentation/android-apps/meta-horizon-android-studio-plugin)
- **Immersive Web SDK (WebXR)**: Node.js v20.19.0 or higher; [IWSDK project setup](https://developers.meta.com/horizon/documentation/web/iwsdk-guide-project-setup) (run `npm create @iwsdk@latest` for the latest version). More: [iwsdk.dev](https://iwsdk.dev), [github.com/facebook/immersive-web-sdk](https://github.com/facebook/immersive-web-sdk)

Only tools, SDKs and features released to the general public or to Start members are allowed. Unreleased Meta tools or features are not permitted.

## What to submit

Three things: a playable build, a short video, and the submission form. Get the build access right: judges can't score what they can't launch.

### 1. Your project (playable build)

- **Built with Unity, Unreal, Godot, Android/Native or a similar custom engine**: upload an APK to a new release channel named "Competition" in the Meta VR Developer Dashboard. Create and submit an [Invite URL](https://developers.meta.com/horizon/resources/publish-release-channels-add-users/#invite-users-via-url) so judges can access and test your project.
- **Built with IWSDK (WebXR)**: see [Deploying to GitHub Pages](https://developers.meta.com/horizon/documentation/web/iwsdk-guide-build-deploy#deploying-to-github-pages) for how to share a link. You may also use your preferred hosting (e.g. Vercel, DigitalOcean, AWS, Azure). No APK or Developer Dashboard upload is needed.
- Once the entry period has ended, you may not change your submission. Judging is based on the state of the entry at the submission deadline. Keep the project available and accessible throughout judging.
- The project must be free of charge for judges and must work reliably and consistently.

### 2. Demonstration video

- Under three (3) minutes. Judges are not required to watch beyond three minutes, so lead with your best material.
- Show footage of your project as viewed on a Meta VR device, via the XR Simulator, or another equivalent emulator. A headset is not required to make the video.
- Upload to YouTube or Vimeo, make it publicly visible, and put the link on the submission form.

### 3. Submission form (Devpost)

- Submission name
- Submission tagline (140 characters; the Devpost "Elevator pitch" box allows 200, so keep it to 140)
- Track: Entertainment, Gaming, or Productivity
- Division: New Experience, or Adapted / Significantly Updated Experience
- Text description: inspiration, how you built it, and future plans for improvement (suggested 500 words or less)
- For an Adapted / Significantly Updated build: a summary of the new features and capabilities added during the competition window (screenshots, changelogs and demo videos are highly recommended)
- How hand interactions are implemented, and what excites you about the future of VR (optional)
- Target launch date, if not already published on the Meta VR Store
- Name, email and role of each team member, if applicable
- Link to the build (Competition release channel Invite URL, or the hosted WebXR link)

## Other entry requirements (Official Rules, section 4)

- **Platform**: a VR/MR application built for Meta VR devices.
- **Language**: entirely in English or with English subtitles; all entry materials in English or with an English translation.
- **Originality**: original to the entrant, or public domain, or content Meta provided for the contest.
- **No Meta funding**: the project must not have received, or be receiving, direct funding from Meta under a separate agreement (e.g. a Start RFP or other development funding).
- **Third-party material**: you must be licensed to use any third-party tools, code or assets, and may be asked for proof.
- **Content**: suitable for a public forum; follow the Meta VR Developer Content Guidelines for 10+, 13+ or 18+. No malware; nothing deceptive, defamatory, harassing, obscene, hateful or harmful.
- **Third-party rights**: no identifiable people other than the entrants; no infringement of copyright, trademark, privacy or publicity rights; no implied association with Meta; no commercial advertising, brand logos, branded products or commercial artwork.

## Judging (Official Rules, sections 5 and 6)

- **Stage 1 (pass/fail)**: does the entry meet a baseline of viability, reasonably fit the theme, and reasonably apply the required tools and features?
- **Stage 2**: four equally weighted criteria (25% each). Ties are resolved by judges' vote. AI tools may assist judging, but human judges make the final decisions.

| Criterion | Weight | What judges look for |
|---|---|---|
| Innovation & Creativity | 25% | Originality, creative ambition, relevance to the chosen track. Differentiation, developer ingenuity, and unique use of Meta device capabilities (spatial depth, hands-first design, gaze, passthrough, scene understanding, persistent anchors) to drive repeat usage. |
| Experience Design | 25% | Design, mechanics and user journey for the intended audience, with emphasis on seated, hands-first or context-specific use. Intuitive navigation, clear onboarding, a habit-forming purpose. Passthrough must be purposeful: the real room should meaningfully change the experience. FoV-aware design: keep essential UI and interactions within a comfortable, narrower field of view and adapt across Meta VR devices. |
| Technical Implementation | 25% | Technical expertise, reliability, strategic use of platform tools, especially gaze interactions (Unity/Unreal ISDK v207+), hand tracking, passthrough, spatial anchoring and FoV-aware design. Must be performant on Meta Quest hardware (minimum 60 fps), solid and bug-free. For passthrough: correct scene understanding (MRUK), content anchored to detected planes, surfaces and room geometry, and holding up in rooms the developer never tested. |
| Polish & Presentation | 25% | Overall quality: UI/UX, art direction, sound design; performant and visually cohesive; clearly relevant to the track. High-quality submission materials (text, images, video). The video should show real gameplay that honestly represents the experience, lead with the story and what makes the project distinct, and not lean on AI-generated video. |

## Prizes (Official Rules, section 7)

Total: up to $1,000,000 USD. Limit one prize per entry.

| Award | Winner | Runner-up |
|---|---|---|
| Best New Entertainment Experience | $100,000 | $50,000 |
| Best Adapted / Significantly Updated Entertainment Experience | $100,000 | $50,000 |
| Best New Gaming Experience | $100,000 | $50,000 |
| Best Adapted / Significantly Updated Gaming Experience | $100,000 | $50,000 |
| Best New Productivity Experience | $70,000 | $35,000 |
| Best Adapted / Significantly Updated Productivity Experience | $70,000 | $35,000 |

Special awards (open to all tracks and divisions):

| Award | Prize | Focus |
|---|---|---|
| Best Social & Multiplayer Experience | $25,000 | Shared presence: co-watching, cooperative play, social spaces, asymmetric multiplayer |
| Best Agentic Interaction | $25,000 | AI as a core part of the experience: spatial agents, voice-first AI interaction, procedural content, context-aware assistance |
| Best Reason to Come Back | $25,000 | Progression and reward design: something to work toward, visible growth between sessions, a loop that pulls the user back tomorrow |
| Best First Five Minutes | $25,000 | The opening: explains itself fast, teaches controller-free interaction without a wall of text, delivers a payoff before the headset comes off |
| Best Accessibility Forward Experience | $25,000 | Accessible XR: voice alternatives for hand interactions, eyes-only navigation for limited mobility, high-contrast modes, inclusive by default |
| Boldest Original Concept | $25,000 | An idea that couldn't exist anywhere else: a core loop that depends on presence, spatial depth, real-world scale, or eyes and hands |
| Judge's Choice (2 winners) | $20,000 each | Standout entries that don't fit neatly into one track or category |

Prize terms:

- Team and Organization prizes are paid to the Representative, who splits them.
- Winners may need to sign winner documents, show government ID, and provide a bank account (prizes of $1,000 or more).
- Winners outside the US receive IRS Form 1042-S and may have US tax withheld, so the payment can be less than the prize amount.

## Rights and data (Official Rules, sections 8 and 9)

- Entrants keep ownership of their entries and projects.
- By entering, you grant Meta a perpetual, worldwide license to use, edit and show the entry (and your name, likeness, trademarks and Meta profile) to run, evaluate and promote the contest.
- Entry data is handled under the [Supplemental Meta Platforms Technologies Privacy Policy](https://www.meta.com/legal/privacy-policy/).

## Pre-submission checklist (derived from the rules, not official text)

- [ ] Start membership approved and Meta developer account active before submitting.
- [ ] The whole experience can be completed with hands only, never pairing a controller.
- [ ] Seated, two-foot interaction radius; complete moment in 10 minutes or less; fast cold start; clean pause/resume.
- [ ] The core experience still exists if any third-party AI or media service is removed.
- [ ] Holds 60 fps or more on Meta Quest hardware; essential UI inside a narrow, comfortable field of view.
- [ ] Passthrough (if used) changes the experience, and content anchors to detected surfaces.
- [ ] Build link (Invite URL or hosted WebXR link) opens for a logged-out stranger, free of charge.
- [ ] Video is under 3 minutes, public on YouTube or Vimeo, shows real footage, best material first.
- [ ] Tagline 140 characters or fewer; description about 500 words; correct track and division chosen.
- [ ] Division is honest: any pre-existing code means Adapted / Significantly Updated, with a changelog.
- [ ] English text or subtitles; licensed assets only; no brand logos or identifiable people other than entrants.
- [ ] Submitted on Devpost (not left as a draft) before Thu Nov 19, 2026, 7:00 AM AEDT.
- [ ] Build and any backend stay online and unchanged until about December 11, 2026.
