package com.busgo.server.repository;

import com.busgo.server.entity.Ticket;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface TicketRepository extends JpaRepository<Ticket, Long> {
    List<Ticket> findByTripId(Long tripId);
    List<Ticket> findByTripIdAndToStopIdAndStatus(Long tripId, Long toStopId, String status);
    List<Ticket> findByIssuedById(Long userId);
}
