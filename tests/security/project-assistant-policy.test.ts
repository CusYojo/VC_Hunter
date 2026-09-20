import {expect,it} from 'vitest';
import {authorizeApiRequest} from '@/security/api-policy';
it('lets authenticated members use their personal model on project knowledge without granting uploads',()=>{
 for(const role of ['org_admin','investment_manager','researcher','viewer','compliance_reviewer'])expect(authorizeApiRequest('POST','/api/v1/projects/project-1/assistant',[role])).toBe(true);
 expect(authorizeApiRequest('POST','/api/v1/projects/project-1/assistant',[])).toBe(false);
 expect(authorizeApiRequest('POST','/api/v1/projects/project-1/documents',['viewer'])).toBe(false);
});
