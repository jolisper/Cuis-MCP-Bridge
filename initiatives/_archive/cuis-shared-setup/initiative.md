# cuis-shared-setup

## Problem

This repository's Cuis setup is tied to its own checkout. The setup script fetches the Cuis 7.8
distribution into a directory at the repo root, and the headless test scripts hard-code that
location. Nothing outside this checkout can run headless Cuis, and the fact that exactly one Cuis
version is supported is implicit in the layout rather than a deliberate choice.

That blocks work the project wants next. A session started in a different Cuis project cannot
use the bridge's headless capabilities, because the session's directory holds none of the
scripts or the distribution. And the repo's own tooling cannot evolve toward managing more than
one Cuis version, since the version is baked into paths and scripts.

## Goals

- One shared, per-user location holds the Cuis distribution and its frozen base image, kept
  alongside the bridge's existing per-user data and organized by Cuis version.
- The distribution is fetched on demand, pinned to a specific upstream version and verified
  after download, so every user gets the same known-good bits.
- The headless runner is parameterized by where Cuis and the frozen base live, and ships with
  the bridge itself, so nothing depends on the session's working directory or on running from
  this checkout.
- The layout leaves room to manage several Cuis versions later.

## Non-goals

- The MCP tool that runs arbitrary Smalltalk; that is the `run-smalltalk-headless` initiative,
  which builds on this one.
- Actually supporting more than one Cuis version. Only the layout allows for it.
- Changing this repository's own setup and test scripts, or the checkout-local distribution and
  frozen base they use. They stay as they are; retiring them is a later initiative, once this
  capability is running.
- Anything about the locally-built VM.

## Scope

Additive: new capability in the bridge server (the shipped, parameterized runner and the
on-demand fetch behavior) and its documentation. The per-user data area already used by the VM
source tools is the natural home for the shared location. The repository's existing setup
scripts, headless test runners and test skill are untouched, so for a time two Cuis locations
coexist. Moderate in size, and self-contained, since nothing existing depends on it yet.
