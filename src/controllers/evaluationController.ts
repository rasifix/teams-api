import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { dataStore } from '../data/store';
import { PlayerEvaluation } from '../types';
import { getNextSequence } from '../utils/sequence';

// GET /api/groups/:groupId/members/:memberId/evaluations
export const getAllEvaluationsForMember = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { groupId, memberId } = req.params;
    
    // Get the player to check if they exist and are in the correct group
    const player = await dataStore.getPlayerById(memberId);
    
    if (!player) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }
    
    if (player.groupId !== groupId) {
      res.status(404).json({ error: 'Player not found in this group' });
      return;
    }
    
    // Return the evaluations from the player
    const evaluations = player.evaluations || [];
    res.json(evaluations);
  } catch (error) {
    console.error('Error fetching evaluations:', error);
    res.status(500).json({ error: 'Failed to fetch evaluations' });
  }
};

// POST /api/groups/:groupId/members/:memberId/evaluations
export const createEvaluation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { groupId, memberId } = req.params;
    const { evaluationDate, score, comments } = req.body;
    
    // Validate required fields
    if (!evaluationDate || !score) {
      res.status(400).json({ error: 'evaluationDate and score are required' });
      return;
    }
    
    // Validate score structure
    if (!score.technical || !score.intelligence || !score.personality || !score.speed) {
      res.status(400).json({ error: 'score must include technical, intelligence, personality, and speed' });
      return;
    }
    
    // Validate score values are between 1 and 5
    const scoreValues = [score.technical, score.intelligence, score.personality, score.speed];
    if (scoreValues.some(val => typeof val !== 'number' || val < 1 || val > 5)) {
      res.status(400).json({ error: 'All score values must be numbers between 1 and 5' });
      return;
    }
    
    // Get the player to check if they exist and are in the correct group
    const player = await dataStore.getPlayerById(memberId);
    
    if (!player) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }
    
    if (player.groupId !== groupId) {
      res.status(404).json({ error: 'Player not found in this group' });
      return;
    }
    
    // Get the authenticated user's ID
    if (!req.user?.id) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    
    // Create the new evaluation
    const newEvaluation: PlayerEvaluation = {
      id: await getNextSequence('evaluations'),
      playerId: memberId,
      evaluationDate,
      userId: req.user.id,
      score: {
        technical: score.technical,
        intelligence: score.intelligence,
        personality: score.personality,
        speed: score.speed
      },
      comments,
      createdAt: new Date().toISOString()
    };
    
    // Add the evaluation to the player
    const updatedPlayer = await dataStore.addEvaluationToPlayer(memberId, newEvaluation);
    
    if (!updatedPlayer) {
      res.status(500).json({ error: 'Failed to add evaluation' });
      return;
    }
    
    res.status(201).json(newEvaluation);
  } catch (error) {
    console.error('Error creating evaluation:', error);
    res.status(500).json({ error: 'Failed to create evaluation' });
  }
};

// PUT /api/groups/:groupId/members/:memberId/evaluations/:evaluationId
export const updateEvaluation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { groupId, memberId, evaluationId } = req.params;
    const { evaluationDate, score, comments } = req.body;
    
    // Validate required fields
    if (!evaluationDate || !score) {
      res.status(400).json({ error: 'evaluationDate and score are required' });
      return;
    }
    
    // Validate score structure
    if (!score.technical || !score.intelligence || !score.personality || !score.speed) {
      res.status(400).json({ error: 'score must include technical, intelligence, personality, and speed' });
      return;
    }
    
    // Validate score values are between 1 and 5
    const scoreValues = [score.technical, score.intelligence, score.personality, score.speed];
    if (scoreValues.some(val => typeof val !== 'number' || val < 1 || val > 5)) {
      res.status(400).json({ error: 'All score values must be numbers between 1 and 5' });
      return;
    }
    
    // Get the player to check if they exist and are in the correct group
    const player = await dataStore.getPlayerById(memberId);
    
    if (!player) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }
    
    if (player.groupId !== groupId) {
      res.status(404).json({ error: 'Player not found in this group' });
      return;
    }
    
    // Get the authenticated user's ID
    if (!req.user?.id) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    
    // Check if evaluation exists
    const existingEvaluation = player.evaluations?.find(e => e.id === evaluationId);
    if (!existingEvaluation) {
      res.status(404).json({ error: 'Evaluation not found' });
      return;
    }
    
    // Update the evaluation
    const updatedEvaluation: PlayerEvaluation = {
      id: evaluationId,
      playerId: memberId,
      evaluationDate,
      userId: req.user.id,
      score: {
        technical: score.technical,
        intelligence: score.intelligence,
        personality: score.personality,
        speed: score.speed
      },
      comments,
      createdAt: existingEvaluation.createdAt // Preserve original creation time
    };
    
    // Update the evaluation in the player document
    const updatedPlayer = await dataStore.updateEvaluationForPlayer(memberId, evaluationId, updatedEvaluation);
    
    if (!updatedPlayer) {
      res.status(500).json({ error: 'Failed to update evaluation' });
      return;
    }
    
    res.json(updatedEvaluation);
  } catch (error) {
    console.error('Error updating evaluation:', error);
    res.status(500).json({ error: 'Failed to update evaluation' });
  }
};
