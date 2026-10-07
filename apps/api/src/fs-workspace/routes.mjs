import { deliveryContext } from '../delivery/context.mjs';
import { registerWorkspaceRoutes } from './workspace/routes.mjs';
import { registerRoleRoutes } from './review/roles.mjs';
import { registerDocumentRoutes } from './document/routes.mjs';
import { registerChangeRoutes } from './changes/routes.mjs';
import { registerAttachmentRoutes } from './attachments/routes.mjs';
import { registerRunRoutes } from './runs/routes.mjs';
import { registerConversationRoutes } from './conversation/routes.mjs';
import { registerEventRoutes } from './runs/events.mjs';
import { registerReviewRoutes } from './review/routes.mjs';
import {registerExportRoutes} from './export/routes.mjs';

export function registerFsWorkspaceRoutes(app, pool, organizationId, requireSession) {
  registerWorkspaceRoutes(app, deliveryContext(pool, organizationId, requireSession));
  registerRoleRoutes(app, deliveryContext(pool, organizationId, requireSession));
  registerDocumentRoutes(app, deliveryContext(pool, organizationId, requireSession));
  registerChangeRoutes(app, deliveryContext(pool, organizationId, requireSession));
  registerAttachmentRoutes(app, deliveryContext(pool, organizationId, requireSession));
  registerRunRoutes(app, deliveryContext(pool, organizationId, requireSession));
  registerConversationRoutes(app, deliveryContext(pool, organizationId, requireSession));
  registerEventRoutes(app, deliveryContext(pool, organizationId, requireSession));
  registerReviewRoutes(app, deliveryContext(pool, organizationId, requireSession));
  registerExportRoutes(app, deliveryContext(pool, organizationId, requireSession));
}
