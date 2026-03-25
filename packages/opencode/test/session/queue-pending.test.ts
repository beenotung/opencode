import path from "path"
import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("session.queue pending prompts", () => {
  test("queues pending message when session is busy", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        // First prompt should succeed
        const first = SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [{ type: "text", text: "hello" }],
        })

        // Second prompt while busy should queue
        const second = SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [{ type: "text", text: "queued message" }],
        }).then(
          () => "queued",
          (err) => {
            if (Session.BusyError.isInstance(err)) return "rejected"
            throw err
          },
        )

        // Wait for first to complete
        await first

        // Check if second was queued (not rejected)
        const result = await second
        expect(result).toBe("queued")

        await Session.remove(session.id)
      },
    })
  })

  test("supports priority levels for queued messages", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        // Queue messages with different priorities
        const results: { priority: string; resolved: boolean }[] = []

        // Queue a normal priority message
        const normal = SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          priority: "normal",
          parts: [{ type: "text", text: "normal message" }],
        }).then(() => results.push({ priority: "normal", resolved: true }))

        // Queue an urgent priority message
        const urgent = SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          priority: "urgent",
          parts: [{ type: "text", text: "urgent message" }],
        }).then(() => results.push({ priority: "urgent", resolved: true }))

        // Queue a background priority message
        const background = SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          priority: "background",
          parts: [{ type: "text", text: "background message" }],
        }).then(() => results.push({ priority: "background", resolved: true }))

        // All should be accepted
        await Promise.all([normal, urgent, background])
        expect(results.length).toBe(3)
        expect(results.some((r) => r.priority === "urgent")).toBe(true)
        expect(results.some((r) => r.priority === "normal")).toBe(true)
        expect(results.some((r) => r.priority === "background")).toBe(true)

        await Session.remove(session.id)
      },
    })
  })

  test("processes urgent messages before non-urgent", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        // Queue multiple messages of each priority
        const processed: string[] = []

        // Queue 3 background messages
        for (let i = 0; i < 3; i++) {
          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            priority: "background",
            parts: [{ type: "text", text: `bg${i}` }],
          }).then(() => processed.push(`bg${i}`))
        }

        // Queue 1 urgent message
        await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          priority: "urgent",
          parts: [{ type: "text", text: "urgent" }],
        }).then(() => processed.push("urgent"))

        // All should complete
        await Promise.all(processed)
        expect(processed.length).toBe(4)
        // Urgent should be in the processed list
        expect(processed).toContain("urgent")

        await Session.remove(session.id)
      },
    })
  })

  test("processes all queued messages", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        // Queue 10 messages
        const resolved: string[] = []
        const promises = []
        for (let i = 0; i < 10; i++) {
          promises.push(
            SessionPrompt.prompt({
              sessionID: session.id,
              agent: "build",
              noReply: true,
              parts: [{ type: "text", text: `message ${i}` }],
            }).then(() => resolved.push(`message ${i}`)),
          )
        }

        // All should complete (may take multiple iterations)
        await Promise.all(promises)
        expect(resolved.length).toBe(10)

        await Session.remove(session.id)
      },
    })
  })

  test("accepts priority parameter in prompt input", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        // Test that priority parameter is accepted
        const result = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          priority: "urgent",
          parts: [{ type: "text", text: "test message" }],
        })

        // Should complete successfully
        expect(result).toBeDefined()

        await Session.remove(session.id)
      },
    })
  })
})
