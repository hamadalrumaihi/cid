/** SIB standing predicates, re-exported through the permission module (the
 *  rules themselves stay in siu.ts beside the labels and fetch helpers they
 *  document; components import them from here). */
export {
  siuStanding, siuOperates, maySwitchDepartment, siuIsAgent, siuIsCommand, siuCanAppoint,
  siuCanAppointRole, siuCanRemove, siuCaseAccess, siuCaseReadOnly, siuCanReadCid,
  siuAssignableClassifications, siuMayRequestAccess, siuCanReviewReferrals, siuCanResolveConflict,
  isOversightStanding, userDepartment,
  type SiuStanding, type SiuContext, type SiuMembership, type Department,
} from '../siu'
