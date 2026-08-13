import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import axios from "axios";
import { logger } from "../utils/logger";
import { auditLog } from "../utils/audit-logger";
import { generateEphemeralToken } from "./auth";
import { AzureOpenAIClient } from "../openai/azure-client";

export interface VoiceSession {
  sessionId: string;
  clientSecret: string;
  model: string;
  voice: string;
  expiresAt: number;
  createdAt: number;
  userId: string;
  organizationId: string;
}

export interface SessionRequest {
  userId: string;
  organizationId: string;
  intent?: "governance" | "security" | "research" | "general";
  voice?: string;
}

/**
 * Session Gateway: Manages voice session lifecycle
 * - Creates ephemeral tokens
 * - Enforces policies
 * - Audits all access
 */
export class SessionGateway {
  private sessionCache = new Map<string, VoiceSession>();
  private readonly SESSION_TTL = 3600000; // 1 hour

  async createSession(
    req: Request<{}, {}, SessionRequest>,
    res: Response
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const { userId, organizationId, intent = "general", voice = "alloy" } =
        req.body;

      // Validate request
      if (!userId || !organizationId) {
        auditLog({
          type: "SESSION_CREATE_FAILED",
          userId,
          organizationId,
          reason: "Missing required fields",
          timestamp: new Date(),
        });

        res.status(400).json({
          error: "Missing userId or organizationId",
        });
        return;
      }

      const sessionId = uuidv4();
      const ephemeralToken = await generateEphemeralToken(
        userId,
        organizationId,
        sessionId
      );

      // Create OpenAI Realtime session
      const openaiSession = await this.createOpenAISession(
        voice,
        intent,
        organizationId
      );

      const session: VoiceSession = {
        sessionId,
        clientSecret: ephemeralToken,
        model: openaiSession.model,
        voice,
        expiresAt: Date.now() + this.SESSION_TTL,
        createdAt: Date.now(),
        userId,
        organizationId,
      };

      // Cache session
      this.sessionCache.set(sessionId, session);

      // Audit successful creation
      auditLog({
        type: "SESSION_CREATED",
        sessionId,
        userId,
        organizationId,
        intent,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      });

      logger.info(`Voice session created: ${sessionId}`, {
        userId,
        organizationId,
        intent,
      });

      // Return only ephemeral token and session ID
      res.json({
        session_id: sessionId,
        client_secret: {
          value: ephemeralToken,
        },
        model: openaiSession.model,
        voice,
        expires_in: this.SESSION_TTL / 1000,
      });
    } catch (error) {
      logger.error("Failed to create voice session", error);
      auditLog({
        type: "SESSION_CREATE_ERROR",
        error: error instanceof Error ? error.message : "Unknown error",
        userId: req.body.userId,
        organizationId: req.body.organizationId,
        timestamp: new Date(),
      });

      res.status(500).json({
        error: "Failed to create session",
      });
    }
  }

  async validateSession(
    sessionId: string,
    token: string
  ): Promise<VoiceSession | null> {
    const session = this.sessionCache.get(sessionId);

    if (!session) {
      auditLog({
        type: "SESSION_VALIDATION_FAILED",
        sessionId,
        reason: "Session not found",
        timestamp: new Date(),
      });
      return null;
    }

    if (Date.now() > session.expiresAt) {
      this.sessionCache.delete(sessionId);
      auditLog({
        type: "SESSION_EXPIRED",
        sessionId,
        userId: session.userId,
        organizationId: session.organizationId,
        timestamp: new Date(),
      });
      return null;
    }

    // Validate token
    if (session.clientSecret !== token) {
      auditLog({
        type: "SESSION_INVALID_TOKEN",
        sessionId,
        userId: session.userId,
        organizationId: session.organizationId,
        timestamp: new Date(),
      });
      return null;
    }

    return session;
  }

  async terminateSession(sessionId: string): Promise<void> {
    const session = this.sessionCache.get(sessionId);

    if (session) {
      this.sessionCache.delete(sessionId);
      auditLog({
        type: "SESSION_TERMINATED",
        sessionId,
        userId: session.userId,
        organizationId: session.organizationId,
        timestamp: new Date(),
      });

      logger.info(`Voice session terminated: ${sessionId}`);
    }
  }

  private async createOpenAISession(
    voice: string,
    intent: string,
    organizationId: string
  ): Promise<{ model: string }> {
    const client = new AzureOpenAIClient(organizationId);

    // Route to appropriate agent based on intent
    const instructions = this.getSystemInstructions(intent);

    try {
      const response = await client.createRealtimeSession({
        model: "gpt-4-realtime-preview",
        voice,
        instructions,
      });

      return response;
    } catch (error) {
      logger.error("Failed to create OpenAI session", error);
      throw error;
    }
  }

  private getSystemInstructions(intent: string): string {
    const baseInstructions = `
# Role and Objective
You are Omega-9 Voice Interface, a sophisticated voice agent designed for enterprise governance and secure command execution.

# Personality and Tone
- Clear, concise, professional
- Strategic delivery with controlled authority
- American accent equivalent in writing
- Executive narration style

# Response Guidelines
- Keep spoken responses short and actionable
- Ask clarifying questions when uncertain
- Avoid filler words and unnecessary elaboration
- Pause naturally between concepts

# Safety Constraints
- Never expose credentials or secrets
- Confirm sensitive operations before execution
- Escalate to human review for compliance-critical decisions
- Log all interactions for audit compliance
`;

    const intentSpecific: Record<string, string> = {
      governance: `\n# Governance Mode\nYou are routing to SOPHIA_KEY agent.\nFocus on policy compliance, risk assessment, and governance frameworks.\nProvide evidence-based recommendations.`,
      security: `\n# Security Mode\nYou are routing to LEO_LEO_FIRESTORM agent.\nPrioritize threat detection and anomaly flagging.\nEscalate high-risk findings immediately.`,
      research: `\n# Research Mode\nYou are routing to INFO_AGI agent.\nProvide data-driven insights and analysis.\nCite sources for all claims.`,
      general: `\n# General Mode\nYou are a general-purpose assistant.\nHandle diverse queries with equal priority.\nRoute complex issues to specialized agents as needed.`,
    };

    return baseInstructions + (intentSpecific[intent] || intentSpecific.general);
  }
}

export const sessionGateway = new SessionGateway();
