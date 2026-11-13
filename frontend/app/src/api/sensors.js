// Sensors (iMonnit feed into the logbooks)
import { get, post } from './client.js';

export const getSensors = (opts) => get('/sensors', opts);
export const getEquipmentSensors = (equipmentId, opts) => get('/sensors/equipment/' + equipmentId, opts);
export const readSensorsNow = () => post('/sensors/read-now', {});
export const saveSensorConnection = (body) => post('/sensors/connection', body);
export const linkSensor = (body) => post('/sensors/links', body);
export const approveSensorLink = (id, body) => post(`/sensors/links/${id}/approve`, body);
export const retireSensorLink = (id, body) => post(`/sensors/links/${id}/retire`, body);
export const rejudgeSensorLink = (id, body) => post(`/sensors/links/${id}/rejudge`, body);
