# Changelog

## 1.0.0 (2026-08-11)


### Features

* add proc-man daemon cli and process runtime ([90a5520](https://github.com/ericwooley/proc-man/commit/90a552025d868c4453ae5808677162e363dd7d19))
* add process detail and full logs ([e359828](https://github.com/ericwooley/proc-man/commit/e35982876a020a9478710364db930dcb5846af4f))
* add React process console ([eb58da9](https://github.com/ericwooley/proc-man/commit/eb58da901d9fe9a31ffd3bd0b9d299b783172fc5))
* add zero-state UI prototype ([c0a650a](https://github.com/ericwooley/proc-man/commit/c0a650abec6cfaa99017a41da0ea3758f317d8cf))
* **cli:** print agent instructions ([64d8532](https://github.com/ericwooley/proc-man/commit/64d853253a386a5fb2be48673441777c7a6b3b0b))
* establish proc-man domain and storage ([738776f](https://github.com/ericwooley/proc-man/commit/738776fd386901fb9dd1b92d5e63fe2b53b82b5a))
* filter processes by directory ([d32fdf1](https://github.com/ericwooley/proc-man/commit/d32fdf1eba5cec1e964cde743ba36e07408cb9be))
* finish proc-man local service ([7a53ec7](https://github.com/ericwooley/proc-man/commit/7a53ec7ed116ecc02143bab10e1f8d59f450bbcb))
* organize processes by directory ([6d2048b](https://github.com/ericwooley/proc-man/commit/6d2048b44830fb5b26cfb53f5ac53aa39dba44a3))
* rebuild prototype around processes and tags ([557342d](https://github.com/ericwooley/proc-man/commit/557342d6a14125adb66f4b691604ffc295f5d35e))


### Bug Fixes

* align endpoint search and restart semantics ([28df058](https://github.com/ericwooley/proc-man/commit/28df058b43799aa663aea606ef61fcbce19c267e))
* align prototype lifecycle contracts ([1c2c87a](https://github.com/ericwooley/proc-man/commit/1c2c87a6d6cdb7657a0a9b39a610de1ee1c6f539))
* align prototype run semantics ([b6aa8ff](https://github.com/ericwooley/proc-man/commit/b6aa8ffb8e09c872311e6c0e248b0662ba778be4))
* align run and log contracts ([81ddd62](https://github.com/ericwooley/proc-man/commit/81ddd6272c4303e85515f8c9dd42b14c333ebbf3))
* bound narrow run inventory ([c9b53b3](https://github.com/ericwooley/proc-man/commit/c9b53b3279c639ae08fe9dea790f7493aec4d180))
* cancel stale worktree transitions ([81a4f78](https://github.com/ericwooley/proc-man/commit/81a4f78b195b2e03bb0f6ebbe3bd9a83639400cc))
* clarify worktree states and focus ([8f3d512](https://github.com/ericwooley/proc-man/commit/8f3d5120a6fb3366c1a1554e6f9f82d94258dee6))
* close final process manager review gaps ([b7148c8](https://github.com/ericwooley/proc-man/commit/b7148c8095b8a9ae878f1c486cd4414863a3bab1))
* complete aggregate process workflows ([06d4350](https://github.com/ericwooley/proc-man/commit/06d43503a31e6b6a8de3aa2e8785138136c24a27))
* complete discovery and retained log workflows ([b26364f](https://github.com/ericwooley/proc-man/commit/b26364f7a2a3a453a2ecb8696f06c21186350246))
* complete process detail log controls ([2f8e554](https://github.com/ericwooley/proc-man/commit/2f8e55415193d758c48ebfaf4a1cfee6b6d062cb))
* complete retained run discovery ([2af6f71](https://github.com/ericwooley/proc-man/commit/2af6f715d883b0f8efdb2ac009ef25a5a3949aa6))
* configure SQLite locks per connection ([d46b7bc](https://github.com/ericwooley/proc-man/commit/d46b7bcb8ad5959a229639879380259688443e4c))
* expose selected log runs ([cbc3dc9](https://github.com/ericwooley/proc-man/commit/cbc3dc99c9183939acb46ee137393171ae35cfe1))
* harden prototype interactions ([f740980](https://github.com/ericwooley/proc-man/commit/f7409805d593775cf084603de1e0b423ff8b5f68))
* keep roving tabs inside drawer ([8a74f7f](https://github.com/ericwooley/proc-man/commit/8a74f7f2c3e818de75247ec3b1a7b89aba11fc0e))
* keep stopping worktrees transitional ([95e0c90](https://github.com/ericwooley/proc-man/commit/95e0c90f137b770584724a86f98573d0de24ee54))
* make process rail button actionable ([0661943](https://github.com/ericwooley/proc-man/commit/06619437a3bf2835d77beed331f008959c49c8fa))
* preserve detail lifecycle focus ([cfda3e2](https://github.com/ericwooley/proc-man/commit/cfda3e2db2b9e2a523e7716060cbb5db8ad72441))
* preserve focus contrast on dark surfaces ([689ab83](https://github.com/ericwooley/proc-man/commit/689ab83273d1d0a922033b1e1078d4e9b17251ae))
* preserve live log context ([ba1d397](https://github.com/ericwooley/proc-man/commit/ba1d3973c46af4276303fb2dd3cfe23157eda5b7))
* preserve worktree log selection ([8063f60](https://github.com/ericwooley/proc-man/commit/8063f60f4afa657b10781ca1c81de03a2607262a))
* reconcile registration and process intent ([31147d4](https://github.com/ericwooley/proc-man/commit/31147d4165869fc44e843f6b2cac03b2327eb26e))
* reflect restart state across surfaces ([94dac4f](https://github.com/ericwooley/proc-man/commit/94dac4fce581f569ffd3695caf1df40e9ac99475))
* refresh live runs across views ([6fe029d](https://github.com/ericwooley/proc-man/commit/6fe029d30b76340fe52dde4153cb0f25d3940ae7))
* restore returned worktree processes ([987e7ea](https://github.com/ericwooley/proc-man/commit/987e7ea7adae36dce2ac1f9b7da8683b72e51a69))
* retain logs by process run ([db26164](https://github.com/ericwooley/proc-man/commit/db261649e7b44f73050a4006644230809301f3be))
* retain runs after deregistration ([3f7f7f8](https://github.com/ericwooley/proc-man/commit/3f7f7f8e2acadf31c0e650327592ed06012df7e9))
* stabilize state label contrast ([0d68f79](https://github.com/ericwooley/proc-man/commit/0d68f790d142283970fc3599e8cbb75dd31b6ed2))
* standardize retained log records ([02c0b9d](https://github.com/ericwooley/proc-man/commit/02c0b9d89b9af785c9cb198f5878ec6316caa898))
* verify clipboard outcomes ([277ed35](https://github.com/ericwooley/proc-man/commit/277ed3595c1206207243fd5678b2064e3670ee45))
* version aggregate process results ([361290e](https://github.com/ericwooley/proc-man/commit/361290eee0e598fa18f7bdbe6f6950b181c0f203))
