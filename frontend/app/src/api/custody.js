// The chain of custody, receiving with a signature, and sample photos (backend: custody module)
import { get, post, put } from './client.js';

export const getCustody = (orderId, { fresh = false } = {}) => get(`/orders/${orderId}/custody`, { fresh });
export const attachPaperCopy = (orderId, body) => post(`/orders/${orderId}/custody/paper`, body);
export const receiveSamples = (orderId, body) => post(`/orders/${orderId}/receive`, body);
export const samplePhotos = (sampleId, { fresh = false } = {}) => get(`/samples/${sampleId}/photos`, { fresh });
export const addPhotos = (sampleId, photos) => post(`/samples/${sampleId}/photos`, { photos });
export const changePhoto = (photoId, body) => put(`/photos/${photoId}`, body);
