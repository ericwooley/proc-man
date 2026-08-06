package events

import (
	"encoding/json"
	"sync"
	"time"
)

type Event struct {
	Type       string    `json:"type"`
	ResourceID string    `json:"resource_id,omitempty"`
	Time       time.Time `json:"time"`
	Data       any       `json:"data,omitempty"`
}

type Broker struct {
	mu          sync.Mutex
	subscribers map[chan Event]struct{}
}

func New() *Broker {
	return &Broker{subscribers: map[chan Event]struct{}{}}
}

func (broker *Broker) Publish(event Event) {
	if event.Time.IsZero() {
		event.Time = time.Now().UTC()
	}
	broker.mu.Lock()
	defer broker.mu.Unlock()
	for subscriber := range broker.subscribers {
		select {
		case subscriber <- event:
		default:
		}
	}
}

func (broker *Broker) Subscribe() (<-chan Event, func()) {
	channel := make(chan Event, 64)
	broker.mu.Lock()
	broker.subscribers[channel] = struct{}{}
	broker.mu.Unlock()
	return channel, func() {
		broker.mu.Lock()
		if _, exists := broker.subscribers[channel]; exists {
			delete(broker.subscribers, channel)
			close(channel)
		}
		broker.mu.Unlock()
	}
}

func (event Event) JSON() []byte {
	bytes, _ := json.Marshal(event)
	return bytes
}
